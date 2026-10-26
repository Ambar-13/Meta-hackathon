// R13.1: a pull request from branch build/w<wave>-<builder> may touch only that builder's globs for that wave, plus the
// always-allowed paths. Prints every foreign path and exits 1. Other branches (main, release) are not builder branches.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The ownership map: globs that every builder may touch, and the globs of each builder in each wave. */
export type OwnershipMap = { always: string[]; waves: Record<string, Record<string, string[]>> };

/** The foreign paths of one branch, and the builder the branch belongs to (null when the branch has no builder). */
export type ForeignPathsResult = { builder: string | null; foreign: string[] };

const BUILDER_BRANCH = /^build\/w(\d)-([a-z-]+)$/;
const MAP_FILE = fileURLToPath(new URL("./ownership-map.json", import.meta.url));

/** The wave and builder a branch name names, or undefined when the name is not a builder branch (for example main). */
export function builderOfBranch(branch: string): { wave: string; builder: string } | undefined {
  const match = BUILDER_BRANCH.exec(branch);
  const waveDigit = match?.[1];
  const builder = match?.[2];
  if (waveDigit === undefined || builder === undefined) return undefined;
  return { wave: `w${waveDigit}`, builder };
}

// A path is owned when one positive glob matches it and no negated glob (one that starts with "!") matches it.
function isOwnedBy(path: string, globs: readonly string[]): boolean {
  const positives = globs.filter((glob) => !glob.startsWith("!"));
  const negatives = globs.filter((glob) => glob.startsWith("!")).map((glob) => glob.slice(1));
  return positives.some((glob) => matchesGlob(path, glob)) && !negatives.some((glob) => matchesGlob(path, glob));
}

/**
 * The paths a branch changed that its builder does not own. Branches with no builder return no foreign paths.
 * Throws path_ownership_unknown_builder when the wave has no such builder, so a typo in a branch name fails loudly.
 */
export function findForeignPaths(input: {
  branch: string;
  changedPaths: readonly string[];
  map: OwnershipMap;
}): ForeignPathsResult {
  const owner = builderOfBranch(input.branch);
  if (owner === undefined) return { builder: null, foreign: [] };
  const globs = input.map.waves[owner.wave]?.[owner.builder];
  if (globs === undefined)
    throw new Error(
      `path_ownership_unknown_builder: ${owner.builder} is not a builder in ${owner.wave}. Check scripts/ownership-map.json.`,
    );
  const foreign = input.changedPaths.filter(
    (path) => !isOwnedBy(path, globs) && !input.map.always.some((glob) => matchesGlob(path, glob)),
  );
  return { builder: owner.builder, foreign };
}

// The value after a command-line flag, or a usage error that names the flag.
function argumentAfter(argv: readonly string[], flag: string): string {
  const index = argv.indexOf(flag);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined) throw new Error(`path_ownership_usage: ${flag} needs a value, for example --branch build/w2-briefs --base origin/main.`);
  return value;
}

// Every file that differs from the base ref, as the changed paths of the branch.
function changedPathsSince(base: string): string[] {
  const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" });
  return output.split("\n").filter((line) => line.trim() !== "");
}

// The message that tells the builder where its foreign file change belongs instead.
function requestHint(branch: string, path: string): string {
  const owner = builderOfBranch(branch);
  const requestName = branch.replace(/\//g, "-");
  return `path_ownership_foreign: ${path} is not owned by ${owner?.builder ?? ""} in ${owner?.wave ?? ""}; write requests/${requestName}-<nnn>.md with the exact diff instead of editing it.`;
}

/** Runs the check from the command line and returns the exit code: 0 for a passing or skipped branch, 1 for a foreign path. */
export function runPathOwnership(argv: readonly string[]): number {
  try {
    const branch = argumentAfter(argv, "--branch");
    const base = argumentAfter(argv, "--base");
    if (builderOfBranch(branch) === undefined) {
      console.log("path_ownership_skipped: branch has no builder");
      return 0;
    }
    const map = JSON.parse(readFileSync(MAP_FILE, "utf8")) as OwnershipMap;
    const result = findForeignPaths({ branch, changedPaths: changedPathsSince(base), map });
    for (const path of result.foreign) console.error(requestHint(branch, path));
    return result.foreign.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runPathOwnership(process.argv.slice(2));
}
