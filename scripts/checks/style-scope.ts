// Decides whether a style finding is an error or a warning.
// The files and folders that have had their style pass are listed in style-checked-paths.json.
// A finding inside one of them is an error. Everywhere else it is a warning, until the style
// pass cleans that folder up and adds it to the list.
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Where the list of files and folders that have had their style pass is kept. */
export const STYLE_CHECKED_FILE = "scripts/checks/style-checked-paths.json";

/** How serious a style finding is. An error fails `pnpm checks`; a warning is only printed. */
export type StyleLevel = "error" | "warning";

type PassedList = { about: string; paths: string[] };

function isPassedList(value: unknown): value is PassedList {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { about?: unknown; paths?: unknown };
  const hasPaths =
    Array.isArray(candidate.paths) && candidate.paths.every((path) => typeof path === "string");
  return typeof candidate.about === "string" && hasPaths;
}

/**
 * Reads the passed list. A missing or badly shaped list throws, so a broken list can never
 * quietly turn every error into a warning.
 */
export function readPassedPaths(root: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(root, STYLE_CHECKED_FILE), "utf8"));
  if (!isPassedList(parsed))
    throw new Error(`${STYLE_CHECKED_FILE} must look like {"about": "...", "paths": ["..."]}`);
  return parsed.paths;
}

/** Turns an absolute path into a repository path with forward slashes, such as "docs/architecture/OVERVIEW.md". */
export function repositoryPath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

/** "error" when the file is on the passed list or inside a passed folder, otherwise "warning". */
export function levelFor(root: string, file: string, passedPaths: readonly string[]): StyleLevel {
  const path = repositoryPath(root, file);
  const isPassed = passedPaths.some((passed) => path === passed || path.startsWith(`${passed}/`));
  return isPassed ? "error" : "warning";
}
