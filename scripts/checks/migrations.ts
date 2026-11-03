// Migration rules for packages/db/migrations.
// Every file starts with the package line and a one-sentence comment, and its number is unique and inside a range
// from ranges.txt. Every CREATE TABLE in public needs ENABLE and FORCE row-level security and a policy, unless the
// table is listed in global-tables.txt. The words BYPASSRLS and SUPERUSER are banned, because a role that can bypass
// row security would defeat every policy.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Finding } from "./finding.js";
import { walkFiles } from "./walk-files.js";

/** The folder that holds the migrations, relative to the repository root. */
const MIGRATIONS_FOLDER = "packages/db/migrations";
/** The file that lists the number ranges, one "NNNN-NNNN owner" line per owner. */
const RANGES_FILE = "packages/db/migrations/ranges.txt";
/** The file that lists tables exempt from the row-level security rule. It is empty today. */
const GLOBAL_TABLES_FILE = "packages/db/migrations/global-tables.txt";
/** The first line every migration must have. */
const PACKAGE_LINE = /^--\s*package:\s*db\s*$/;
/** One line of ranges.txt. */
const RANGE_LINE = /^(\d{4})-(\d{4})\s+(\S+)$/;

/** Numbers an owner may use, inclusive, from ranges.txt. */
type NumberRange = { first: number; last: number; owner: string };

/** Reads ranges.txt. A missing file, or a line that is not "NNNN-NNNN owner", is a finding. */
function readRanges(root: string): { ranges: NumberRange[]; findings: Finding[] } {
  const file = join(root, RANGES_FILE);
  if (!existsSync(file)) {
    return {
      ranges: [],
      findings: [{ check: "migrations", file, line: 1, message: `${RANGES_FILE} is missing, so no number can be checked` }],
    };
  }
  const ranges: NumberRange[] = [];
  const findings: Finding[] = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, index) => {
      if (text.trim() === "") return;
      const match = RANGE_LINE.exec(text.trim());
      const first = match?.[1];
      const last = match?.[2];
      const owner = match?.[3];
      if (first === undefined || last === undefined || owner === undefined) {
        findings.push({ check: "migrations", file, line: index + 1, message: "must read NNNN-NNNN owner" });
        return;
      }
      ranges.push({ first: Number(first), last: Number(last), owner });
    });
  return { ranges, findings };
}

/** The table names listed in global-tables.txt. Lines may hold a # comment. */
function globalTables(root: string): Set<string> {
  const file = join(root, GLOBAL_TABLES_FILE);
  if (!existsSync(file)) return new Set();
  return new Set(
    readFileSync(file, "utf8")
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter((line) => line !== ""),
  );
}

/** The first line must name the package, and the second line must be a comment of one sentence. */
function headerProblems(sql: string): string[] {
  const [first = "", second = ""] = sql.split("\n");
  const problems: string[] = [];
  if (!PACKAGE_LINE.test(first.trim())) problems.push("first line must say: -- package: db");
  const comment = second.trim();
  const sentences = (comment.match(/[.!?](\s|$)/g) ?? []).length;
  if (!comment.startsWith("--") || !comment.endsWith(".") || sentences !== 1)
    problems.push("second line must be a comment of one sentence that ends with a full stop");
  return problems;
}

/** Whether the number sits inside one owner's range from ranges.txt. */
function numberProblems(number: number, ranges: readonly NumberRange[]): string[] {
  if (ranges.some((range) => number >= range.first && number <= range.last)) return [];
  return [`number ${String(number)} is in no range of ${RANGES_FILE}`];
}

/** The banned-word and row-level-security problems of one migration. */
function securityProblems(sql: string, globals: ReadonlySet<string>): string[] {
  const lower = sql.toLowerCase();
  const problems: string[] = [];
  if (/\bbypassrls\b/.test(lower)) problems.push("BYPASSRLS is banned");
  if (/\bsuperuser\b/.test(lower.replace(/--.*$/gm, ""))) problems.push("SUPERUSER is banned");
  for (const created of lower.matchAll(/create table (?:if not exists )?([a-z_]+)/g)) {
    const table = created[1] ?? "";
    if (globals.has(table)) continue;
    if (!lower.includes(`alter table ${table} enable row level security`))
      problems.push(`${table} lacks ENABLE ROW LEVEL SECURITY`);
    if (!lower.includes(`alter table ${table} force row level security`))
      problems.push(`${table} lacks FORCE ROW LEVEL SECURITY`);
    if (!new RegExp(`create policy [a-z0-9_"]+ on ${table}\\b`).test(lower))
      problems.push(`${table} has no CREATE POLICY`);
  }
  return problems;
}

/** pnpm checks entry: every rule above, for every migration in the folder, in file-name order. */
export function checkMigrations(root: string): Finding[] {
  const { ranges, findings } = readRanges(root);
  const globals = globalTables(root);
  const seen = new Map<number, string>();
  for (const file of walkFiles(root, MIGRATIONS_FOLDER, (name) => name.endsWith(".sql")).sort()) {
    const name = basename(file);
    const numberText = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name)?.[1];
    if (numberText === undefined) {
      findings.push({ check: "migrations", file, line: 1, message: "file name must be NNNN_snake_name.sql" });
      continue;
    }
    const number = Number(numberText);
    const sql = readFileSync(file, "utf8");
    const earlier = seen.get(number);
    if (earlier !== undefined) findings.push({ check: "migrations", file, line: 1, message: `number ${numberText} repeats ${earlier}` });
    seen.set(number, name);
    const problems = [...headerProblems(sql), ...numberProblems(number, ranges), ...securityProblems(sql, globals)];
    findings.push(...problems.map((message) => ({ check: "migrations", file, line: 1, message })));
  }
  return findings;
}
