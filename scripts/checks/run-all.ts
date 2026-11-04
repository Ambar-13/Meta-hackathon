// pnpm checks: the mechanical checks that apply in this repository, one exit code.
// Each finding prints as path:line level message. An error fails the run; a warning only prints.
// The Mermaid check runs inside the architecture-docs check, so it is not listed here.
import { relative } from "node:path";
import { checkArchitectureDocs } from "./architecture-docs.js";
import { checkBannedFileNames } from "./banned-file-names.js";
import { type Finding } from "./finding.js";
import { checkMigrations } from "./migrations.js";
import { noEmDash } from "./no-em-dash.js";
import { checkPlainWords } from "./plain-words.js";
import { checkReadmeHeadings } from "./readme-headings.js";

const root = process.cwd();
const checks: readonly ((root: string) => Finding[])[] = [
  checkBannedFileNames,
  checkPlainWords,
  noEmDash,
  checkReadmeHeadings,
  checkArchitectureDocs,
  checkMigrations,
];
const findings = checks.flatMap((check) => check(root));
for (const finding of findings) {
  console.error(
    `${relative(root, finding.file)}:${String(finding.line)} ${finding.level ?? "error"} ${finding.message}`,
  );
}
const errors = findings.filter((finding) => (finding.level ?? "error") === "error").length;
console.log(errors === 0 ? "checks: no errors" : `checks: ${String(errors)} error(s)`);
process.exit(errors === 0 ? 0 : 1);
