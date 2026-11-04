// Lists the files the checks read.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Folders no check ever reads: installed packages, build output, git's own files, the local
// database cluster and test coverage reports.
const SKIPPED_FOLDERS = new Set([
  "node_modules",
  "dist",
  "dist-prerender",
  ".git",
  ".local",
  "coverage",
]);

/**
 * Every file under root/folder whose name passes the filter, as absolute paths.
 * A folder that does not exist gives an empty list, so a check on a small test tree does not throw.
 */
export function walkFiles(
  root: string,
  folder: string,
  isWanted: (name: string) => boolean,
): string[] {
  const start = join(root, folder);
  let names: string[];
  try {
    names = readdirSync(start);
  } catch {
    // A missing folder is normal for most checks (a test tree holds only what the test needs).
    return [];
  }
  return names
    .filter((name) => !SKIPPED_FOLDERS.has(name))
    .flatMap((name) => {
      const path = join(start, name);
      if (statSync(path).isDirectory()) return walkFiles(root, relative(root, path), isWanted);
      return isWanted(name) ? [path] : [];
    });
}
