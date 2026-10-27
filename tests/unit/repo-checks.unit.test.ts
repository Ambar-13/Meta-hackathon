// Tests for the frozen checks in scripts/checks/. Each test writes a small temporary tree that passes every
// check, changes one thing to break it, and runs `pnpm checks` (run-all.ts) inside that tree. The frozen scripts
// are read, never edited: the tests only prove that the checks catch what Wave 2 relies on.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const RUN_ALL = join(REPO_ROOT, "scripts", "checks", "run-all.ts");
const STYLE_FILE = "scripts/checks/style-checked-paths.json";
const EM_DASH = "\u2014";
const TEST_TIMEOUT_MS = 60_000;

const FIVE_HEADINGS = [
  "## What this does",
  "",
  "Serves the test data.",
  "",
  "## What this never does",
  "",
  "It never writes files outside its folder.",
  "",
  "## How it fits",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Browser] --> B[API]",
  "```",
  "",
  "The browser calls the API.",
  "",
  "## The main pieces",
  "",
  "The routes and the sessions.",
  "",
  "## How to test it",
  "",
  "Run the unit tests.",
  "",
].join("\n");

// The five headings, with "How to test it" moved before "What this never does".
const OUT_OF_ORDER = [
  "## What this does",
  "",
  "Serves the test data.",
  "",
  "## How to test it",
  "",
  "Run the unit tests.",
  "",
  "## What this never does",
  "",
  "It never writes files outside its folder.",
  "",
  "## How it fits",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Browser] --> B[API]",
  "```",
  "",
  "## The main pieces",
  "",
  "The routes and the sessions.",
  "",
].join("\n");

const OVERVIEW_DIAGRAMS = [
  "# How it is built",
  "",
  "```mermaid",
  "flowchart LR",
  "  B[Browser] --> A[API]",
  "```",
  "",
  "Notice that the browser only calls the API.",
  "",
  "```mermaid",
  "sequenceDiagram",
  "  participant B as Browser",
  "  participant A as API",
  "  B->>A: GET /api/health",
  "```",
  "",
  "```mermaid",
  "erDiagram",
  "  people ||--o{ sources : owns",
  "```",
  "",
].join("\n");

const STATE_BLOCK = ["```mermaid", "stateDiagram-v2", "  [*] --> first", "  first --> second", "```", ""].join("\n");
const STATES_DOC = ["# States", "", ...Array.from({ length: 6 }, () => STATE_BLOCK)].join("\n");

const SAFETY_DOC = [
  "# Safety",
  "",
  "```mermaid",
  "flowchart TB",
  "  A[Api] --> B[Rows]",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  C[Turn] --> D[Brief]",
  "```",
  "",
].join("\n");

const MIGRATION = [
  "-- package: db",
  "-- Creates the people table with row security on.",
  "CREATE TABLE people (",
  "  id uuid PRIMARY KEY",
  ");",
  "ALTER TABLE people ENABLE ROW LEVEL SECURITY;",
  "ALTER TABLE people FORCE ROW LEVEL SECURITY;",
  "CREATE POLICY people_own ON people USING (true);",
  "",
].join("\n");

// A tree that passes every check. Each test changes one part of it.
const BASE_FILES: Record<string, string> = {
  "README.md": "# Meet First\n\nA note about the project in plain words.\n",
  "apps/api/package.json": '{ "name": "@meet-first/api" }\n',
  "apps/api/README.md": FIVE_HEADINGS,
  "packages/db/package.json": '{ "name": "@meet-first/db" }\n',
  "packages/db/README.md": FIVE_HEADINGS,
  "packages/db/migrations/ranges.txt": "0001-0999 db\n",
  "packages/db/migrations/0001_foundation.sql": MIGRATION,
  "docs/GLOSSARY.md": "# Glossary\n\n- **card**: A persona built from one source.\n",
  "docs/architecture/OVERVIEW.md": OVERVIEW_DIAGRAMS,
  "docs/architecture/STATES.md": STATES_DOC,
  "docs/architecture/SAFETY.md": SAFETY_DOC,
};

type Tree = { files?: Record<string, string>; remove?: string[] };
type Run = { status: number; output: string };

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// Writes the base tree with the changes applied, runs pnpm checks in it, and returns the exit code and output.
function runChecks(tree: Tree): Run {
  const root = mkdtempSync(join(tmpdir(), "w2-checks-"));
  folders.push(root);
  const removed = new Set(tree.remove ?? []);
  const files: Record<string, string> = Object.fromEntries(
    Object.entries({ ...BASE_FILES, ...(tree.files ?? {}) }).filter(([path]) => !removed.has(path)),
  );
  files[STYLE_FILE] = readFileSync(join(REPO_ROOT, STYLE_FILE), "utf8");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const result = spawnSync(TSX, [RUN_ALL], { cwd: root, encoding: "utf8" });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

describe("repo checks", () => {
  it("W2-DEPLOY-T8: pnpm checks fails on an em dash in a .ts comment and in a .md line", () => {
    const run = runChecks({
      files: {
        "scripts/bad-note.ts": `// A note with a dash ${EM_DASH} here.\nexport const NOTE = "x";\n`,
        "docs/extra.md": `A line with a dash ${EM_DASH} here.\n`,
      },
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain("em dash");
    expect(run.output).toContain("scripts/bad-note.ts");
    expect(run.output).toContain("docs/extra.md");
  }, TEST_TIMEOUT_MS);

  it("W3-CHECKS-T1 (D74): pnpm checks reads no recorded model reply, so an em dash the model wrote does not fail it", () => {
    const run = runChecks({
      files: { "packages/evals/fixtures/model-replies/speech/0a1b.json": `{"response": "A reply as the model wrote it ${EM_DASH} kept as received."}\n` },
    });

    expect(run.output).not.toContain("em dash");
    expect(run.status).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("W2-DEPLOY-T9: pnpm checks fails on a file named utils.ts and a folder named helpers", () => {
    const run = runChecks({
      files: {
        "apps/api/src/utils.ts": "export const READY = true;\n",
        "packages/db/src/helpers/index.ts": "export const COUNT = 1;\n",
      },
    });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain('uses the name "utils.ts"');
    expect(run.output).toContain('uses the name "helpers"');
  }, TEST_TIMEOUT_MS);

  it("W2-DEPLOY-T10: pnpm checks fails on a README missing one of the five headings or with them out of order", () => {
    const missing = runChecks({ files: { "apps/api/README.md": FIVE_HEADINGS.replace("## How to test it", "## Testing") } });
    expect(missing.status).not.toBe(0);
    expect(missing.output).toContain("How to test it");

    const outOfOrder = runChecks({ files: { "apps/api/README.md": OUT_OF_ORDER } });
    expect(outOfOrder.status).not.toBe(0);
    expect(outOfOrder.output).toContain("is out of order");
  }, TEST_TIMEOUT_MS);

  it("W2-DEPLOY-T11: pnpm checks fails on a Mermaid block with 16 boxes and passes one with 15", () => {
    const boxes = (count: number): string =>
      ["# How it is built", "", "```mermaid", "flowchart LR", ...[...Array(count).keys()].map((i) => `  N${String(i)}[Box ${String(i)}]`), "```", ""].join("\n");

    // A docs file of its own: OVERVIEW.md must also hold its sequence and data diagrams, which would fail the 15-box case for another reason.
    const fifteen = runChecks({ files: { "docs/box-count.md": boxes(15) } });
    expect(fifteen.status).toBe(0);

    const sixteen = runChecks({ files: { "docs/box-count.md": boxes(16) } });
    expect(sixteen.status).not.toBe(0);
  }, TEST_TIMEOUT_MS);

  it.each([
    "docs/architecture/OVERVIEW.md",
    "docs/architecture/STATES.md",
    "docs/architecture/SAFETY.md",
    "docs/GLOSSARY.md",
  ])("W2-DEPLOY-T12: pnpm checks fails when %s is missing", (path) => {
    const run = runChecks({ remove: [path] });

    expect(run.status).not.toBe(0);
    expect(run.output).toContain(path);
  }, TEST_TIMEOUT_MS);

  it("W2-DEPLOY-T13: pnpm checks fails on a migration without -- package: in its first lines and on a CREATE TABLE without FORCE ROW LEVEL SECURITY", () => {
    const noPackageLine = MIGRATION.replace("-- package: db\n", "");
    const missingPackage = runChecks({ files: { "packages/db/migrations/0002_no_package.sql": noPackageLine } });
    expect(missingPackage.status).not.toBe(0);
    expect(missingPackage.output).toContain("package: db");

    const noForce = MIGRATION.replace("ALTER TABLE people FORCE ROW LEVEL SECURITY;\n", "");
    const missingForce = runChecks({ files: { "packages/db/migrations/0001_foundation.sql": noForce } });
    expect(missingForce.status).not.toBe(0);
    expect(missingForce.output).toContain("lacks FORCE ROW LEVEL SECURITY");
  }, TEST_TIMEOUT_MS);
});
