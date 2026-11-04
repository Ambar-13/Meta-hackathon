// Tests for the forbidden-imports workflow. The grep steps are read from the workflow file itself
// and run with bash -c inside a small temporary tree that holds one planted fault.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "forbidden-imports.yml");

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// The grep steps exactly as the workflow writes them: each run line that starts with "! grep".
function workflowGreps(): string[] {
  return readFileSync(WORKFLOW, "utf8")
    .split("\n")
    .map((line) => /^\s+run: '(! grep.*)'$/.exec(line)?.[1])
    .filter((run): run is string => run !== undefined);
}

// A temporary tree with the apps and packages folders the workflow greps, and the given files
// written into it.
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "w2-forbidden-"));
  folders.push(root);
  for (const folder of ["apps/web", "apps/api", "packages"])
    mkdirSync(join(root, folder), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// The exit code of one grep step from the workflow, run in the tree.
function exitCodeOf(command: string, root: string): number {
  return spawnSync("bash", ["-c", command], { cwd: root, encoding: "utf8" }).status ?? 1;
}

describe("forbidden imports", () => {
  it("W2-DEPLOY-T14 (D74): the forbidden-imports job fails on a mock-api import and on META_API_KEY in apps/web", () => {
    const greps = workflowGreps();
    expect(greps.length).toBeGreaterThanOrEqual(3);

    const clean = makeTree({ "apps/web/src/index.ts": "export const READY = true;\n" });
    const failingOnClean = greps.filter((command) => exitCodeOf(command, clean) !== 0);
    expect(failingOnClean).toEqual([]);

    const mockImport = makeTree({ "packages/scrub/src/bad.ts": 'import "../mock-api";\n' });
    const mockStep = greps.find((command) => command.includes("mock-api")) ?? "";
    expect(mockStep).not.toBe("");
    expect(exitCodeOf(mockStep, mockImport)).not.toBe(0);

    const keyInWeb = makeTree({
      "apps/web/src/env.ts": 'export const KEY_NAME = "META_API_KEY";\n',
    });
    const keyStep = greps.find((command) => command.includes("META_API_KEY")) ?? "";
    expect(keyStep).not.toBe("");
    expect(exitCodeOf(keyStep, keyInWeb)).not.toBe(0);
  });
});
