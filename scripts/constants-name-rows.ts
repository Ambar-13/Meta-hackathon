// R13.5: every exported UPPER_CASE constant in app and package source names its decision row (D1 to D75, A1 to A8,
// R<layer>.<row>, or "invariant <n>") in the three comment lines above it. Prints each miss and exits 1.
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { walkFiles } from "./checks/walk-files.js";

/** One exported constant that has no row id above it. */
export type ConstantMiss = { path: string; line: number; name: string };

const EXPORTED_CONSTANT = /^export const ([A-Z][A-Z0-9_]+)\b/;
const ROW_ID = /\b(D\d{1,2}|A\d|R\d{1,2}\.\d{1,2}|invariant \d{1,2})\b/;
// The row id may sit in the comment block above the constant, so the rule reads the three lines above it.
const LINES_ABOVE = 3;
const SOURCE_PATH = /^(apps|packages)\/[^/]+\/src\//;

/** True for a source file this rule reads. Tests, test helpers and the contracts package are left out. */
export function isCheckedSource(path: string): boolean {
  return (
    SOURCE_PATH.test(path) &&
    /\.tsx?$/.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !path.includes("/testing/") &&
    !path.startsWith("packages/contracts/")
  );
}

/** Every exported UPPER_CASE constant, in the checked files, with no row id in the three lines above it. */
export function findConstantsWithoutRows(files: readonly { path: string; text: string }[]): ConstantMiss[] {
  return files
    .filter((file) => isCheckedSource(file.path))
    .flatMap((file) => {
      const lines = file.text.split("\n");
      return lines.flatMap((text, index) => {
        const name = EXPORTED_CONSTANT.exec(text)?.[1];
        if (name === undefined) return [];
        const above = lines.slice(Math.max(0, index - LINES_ABOVE), index).join("\n");
        return ROW_ID.test(above) ? [] : [{ path: file.path, line: index + 1, name }];
      });
    });
}

// Reads every app and package source file under the root, with paths relative to it, for the command-line run.
function sourceFilesUnder(root: string): { path: string; text: string }[] {
  return ["apps", "packages"]
    .flatMap((folder) => walkFiles(root, folder, (name) => /\.tsx?$/.test(name)))
    .map((file) => ({ path: relative(root, file).split(sep).join("/"), text: readFileSync(file, "utf8") }));
}

/** Prints every miss and returns the exit code: 0 when every checked constant names its row, 1 otherwise. */
export function runConstantsNameRows(root: string): number {
  const misses = findConstantsWithoutRows(sourceFilesUnder(root));
  for (const miss of misses)
    console.error(`${miss.path}:${String(miss.line)} ${miss.name} has no row id in the three lines above it (D, A, R or invariant).`);
  console.log(misses.length === 0 ? "constants-name-rows: every constant names its row" : `constants-name-rows: ${String(misses.length)} miss(es)`);
  return misses.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runConstantsNameRows(process.cwd());
}

