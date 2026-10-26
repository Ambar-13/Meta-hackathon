// Tests for scripts/release.sh. Each test builds a throwaway git repository with a bare origin
// and runs the real script inside it. The deploy hooks are not called: a fake curl on PATH only
// writes its arguments to a log file, so no test makes a network call.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RELEASE_SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "release.sh");
const HOOK_API = "https://hooks.test/api?key=api-key";
const HOOK_WORKER = "https://hooks.test/worker?key=worker-key";

type Fixture = { base: string; repo: string; binDir: string; curlLog: string };

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture.base, { recursive: true, force: true });
});

// Runs one git command in the folder and stops the test when git fails, so a broken setup is never mistaken for a result.
function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

// A repository with one commit on main, a bare origin, and a fake curl that logs its arguments.
function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "w2-release-"));
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  const binDir = join(base, "fake-bin");
  const curlLog = join(base, "curl.log");
  git(base, ["init", "--bare", "-q", origin]);
  mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "e1590974@u.nus.edu"]);
  git(repo, ["config", "user.name", "Ambar"]);
  git(repo, ["remote", "add", "origin", origin]);
  mkdirSync(binDir);
  writeFileSync(join(binDir, "curl"), `#!/usr/bin/env bash\necho "$@" >> "${curlLog}"\n`);
  chmodSync(join(binDir, "curl"), 0o755);
  const fixture = { base, repo, binDir, curlLog };
  fixtures.push(fixture);
  return fixture;
}

function commitFile(repo: string, name: string): void {
  writeFileSync(join(repo, name), `${name}\n`);
  git(repo, ["add", name]);
  git(repo, ["commit", "-q", "-m", `Add ${name}`]);
}

// Runs the real script from the fixture repository with the fake curl first on PATH.
function runRelease(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [RELEASE_SCRIPT, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: { PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "", ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The fake curl's log, or an empty text when curl was never called.
function curlLog(fixture: Fixture): string {
  return existsSync(fixture.curlLog) ? readFileSync(fixture.curlLog, "utf8") : "";
}

describe("release script", () => {
  it("W2-DEPLOY-T1 (D70, R12.3): release.sh refuses without a tag", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, "a.txt");

    // No tag argument and no tag on HEAD: the script must stop before any curl call.
    const result = runRelease(fixture, []);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("release_tag_missing");
    expect(curlLog(fixture)).toBe("");
  });

  it("W2-DEPLOY-T2 (D70): release.sh refuses a tag that is not on release", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, "a.txt");
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    commitFile(fixture.repo, "b.txt");
    git(fixture.repo, ["tag", "v1.0.0"]);

    // The tag sits on main only, one commit ahead of the release branch.
    const result = runRelease(fixture, ["v1.0.0"], { RENDER_DEPLOY_HOOK_API: HOOK_API, RENDER_DEPLOY_HOOK_WORKER: HOOK_WORKER });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("release_tag_not_on_release");
    expect(curlLog(fixture)).toBe("");
  });

  it("W2-DEPLOY-T3 (D70): release.sh refuses when a hook variable is missing, and calls api then worker with ref when both are set", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, "a.txt");
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "v1.0.0"]);

    const onlyApi = runRelease(fixture, ["v1.0.0"], { RENDER_DEPLOY_HOOK_API: HOOK_API });
    expect(onlyApi.status).toBe(2);
    expect(onlyApi.stderr).toContain("release_hooks_missing");
    expect(curlLog(fixture)).toBe("");

    // Both hooks set: the fake curl is called twice, api first, each with the tag as ref.
    const both = runRelease(fixture, ["v1.0.0"], { RENDER_DEPLOY_HOOK_API: HOOK_API, RENDER_DEPLOY_HOOK_WORKER: HOOK_WORKER });
    expect(both.status).toBe(0);
    const lines = curlLog(fixture).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`${HOOK_API}&ref=v1.0.0`);
    expect(lines[1]).toContain(`${HOOK_WORKER}&ref=v1.0.0`);
  });
});
