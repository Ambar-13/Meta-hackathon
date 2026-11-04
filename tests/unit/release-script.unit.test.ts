// Tests for scripts/release.sh. Each test builds a throwaway git repository with a bare origin
// and runs the real script inside it. The deploy hooks are not called: a fake curl on PATH
// writes its arguments to a log file and answers the health check from a list of answers, so no
// test makes a network call.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RELEASE_SCRIPT = join(import.meta.dirname, "..", "..", "scripts", "release.sh");
const HOOK_API = "https://hooks.test/api?key=api-key";
const HOOK_WORKER = "https://hooks.test/worker?key=worker-key";
const HOOK_ONE = "https://hooks.test/one?key=one-key";
const ORIGIN = "https://app.test";
// Everything a full run needs; the waits between health reads are 0 s here.
const FULL_ENV = {
  RENDER_DEPLOY_HOOK_API: HOOK_API,
  RENDER_DEPLOY_HOOK_WORKER: HOOK_WORKER,
  APP_ORIGIN: ORIGIN,
  RELEASE_WAIT_SECONDS: "0",
};
const FIRST_MIGRATION = "packages/db/migrations/0001_foundation.sql";

type Fixture = {
  base: string;
  repo: string;
  binDir: string;
  curlLog: string;
  healthAnswers: string;
};

const fixtures: Fixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture.base, { recursive: true, force: true });
});

// Runs one git command in the folder and stops the test when git fails, so a broken setup is never mistaken for a result.
function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

// Runs one git command and returns what it printed, trimmed.
function gitOutput(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// A repository with no commit yet, a bare origin, and a fake curl that logs its arguments. On a health read the fake
// curl prints the first line of the answers file and removes it, so each read gets the next answer.
function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "w2-release-"));
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  const binDir = join(base, "fake-bin");
  const curlLog = join(base, "curl.log");
  const healthAnswers = join(base, "health-answers.txt");
  git(base, ["init", "--bare", "-q", origin]);
  mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "e1590974@u.nus.edu"]);
  git(repo, ["config", "user.name", "Ambar"]);
  git(repo, ["remote", "add", "origin", origin]);
  mkdirSync(binDir);
  writeFileSync(healthAnswers, "");
  const fakeCurl = [
    "#!/usr/bin/env bash",
    `echo "$@" >> "${curlLog}"`,
    'case "$*" in',
    `  *"/api/health"*) head -n 1 "${healthAnswers}"; tail -n +2 "${healthAnswers}" > "${healthAnswers}.rest"; mv "${healthAnswers}.rest" "${healthAnswers}" ;;`,
    "esac",
    "",
  ].join("\n");
  writeFileSync(join(binDir, "curl"), fakeCurl);
  chmodSync(join(binDir, "curl"), 0o755);
  const fixture = { base, repo, binDir, curlLog, healthAnswers };
  fixtures.push(fixture);
  return fixture;
}

function commitFile(repo: string, name: string): void {
  mkdirSync(dirname(join(repo, name)), { recursive: true });
  writeFileSync(join(repo, name), `${name}\n`);
  git(repo, ["add", name]);
  git(repo, ["commit", "-q", "-m", `Add ${name}`]);
}

// The bodies the fake health route gives, one per read, in order; null is a read that gets no answer (the api is not up).
function answerHealth(fixture: Fixture, versions: Array<number | null>): void {
  const lines = versions.map((version) =>
    version === null
      ? ""
      : JSON.stringify({
          ok: false,
          db: true,
          worker: false,
          schemaVersion: version,
          diskPct: null,
          degraded: false,
        }),
  );
  writeFileSync(fixture.healthAnswers, `${lines.join("\n")}\n`);
}

// Runs the real script from the fixture repository with the fake curl first on PATH.
function runRelease(fixture: Fixture, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [RELEASE_SCRIPT, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: {
      PATH: `${fixture.binDir}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      ...env,
    },
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
    const result = runRelease(fixture, ["v1.0.0"], {
      RENDER_DEPLOY_HOOK_API: HOOK_API,
      RENDER_DEPLOY_HOOK_WORKER: HOOK_WORKER,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("release_tag_not_on_release");
    expect(curlLog(fixture)).toBe("");
  });

  it("W2-DEPLOY-T3 (D70): release.sh refuses when a hook variable is missing, and calls api then worker with the tag's commit as ref when both are set", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, FIRST_MIGRATION);
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "v1.0.0"]);

    const onlyApi = runRelease(fixture, ["v1.0.0"], {
      RENDER_DEPLOY_HOOK_API: HOOK_API,
      APP_ORIGIN: ORIGIN,
    });
    expect(onlyApi.status).toBe(2);
    expect(onlyApi.stderr).toContain("release_hooks_missing");
    expect(curlLog(fixture)).toBe("");

    // Both hooks set and the database already at the tag's schema version: the api hook, one health read, then the worker hook.
    answerHealth(fixture, [1]);
    const both = runRelease(fixture, ["v1.0.0"], FULL_ENV);
    expect(both.status).toBe(0);
    const commit = gitOutput(fixture.repo, ["rev-parse", "v1.0.0^{commit}"]);
    const lines = curlLog(fixture).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(`${HOOK_API}&ref=${commit}`);
    expect(lines[1]).toContain(`${ORIGIN}/api/health`);
    expect(lines[2]).toContain(`${HOOK_WORKER}&ref=${commit}`);
  });

  it("W3-DEPLOY-T1 (D70): the hooks get the commit SHA of an annotated tag, because a Render deploy hook builds a commit SHA and not a tag name", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, FIRST_MIGRATION);
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"]);
    answerHealth(fixture, [1]);

    const result = runRelease(fixture, ["v1.0.0"], FULL_ENV);

    expect(result.status).toBe(0);
    const commit = gitOutput(fixture.repo, ["rev-parse", "v1.0.0^{commit}"]);
    const tagObject = gitOutput(fixture.repo, ["rev-parse", "v1.0.0"]);
    // An annotated tag is its own object, so its id is not the commit's; only the commit id may reach the hooks.
    expect(tagObject).not.toBe(commit);
    const hookLines = curlLog(fixture)
      .trim()
      .split("\n")
      .filter((line) => line.includes("hooks.test"));
    expect(hookLines).toHaveLength(2);
    for (const line of hookLines) expect(line).toContain(`&ref=${commit}`);
    expect(curlLog(fixture)).not.toContain("ref=v1.0.0");
    expect(curlLog(fixture)).not.toContain(tagObject);
  });

  it("W3-DEPLOY-T2 (D70, D71): release.sh calls the worker hook only after the api reports the tag's schema version", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, FIRST_MIGRATION);
    commitFile(fixture.repo, "packages/db/migrations/0002_names_review.sql");
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "v1.0.0"]);
    // The api is not up yet, then it answers on the old schema, then its pre-deploy migrations have run.
    answerHealth(fixture, [null, 1, 2]);

    const result = runRelease(fixture, ["v1.0.0"], FULL_ENV);

    expect(result.status).toBe(0);
    const lines = curlLog(fixture).trim().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain(HOOK_API);
    expect(lines.slice(1, 4).every((line) => line.includes(`${ORIGIN}/api/health`))).toBe(true);
    expect(lines[4]).toContain(HOOK_WORKER);
  });

  it("W3-DEPLOY-T3 (D71): release.sh stops before the worker hook when the schema version does not arrive in time", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, FIRST_MIGRATION);
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "v1.0.0"]);
    answerHealth(fixture, [0, 0, 0]);

    const result = runRelease(fixture, ["v1.0.0"], { ...FULL_ENV, RELEASE_WAIT_TRIES: "3" });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain("release_schema_wait_timeout");
    expect(result.stderr).toContain("schema version 0");
    const lines = curlLog(fixture).trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(HOOK_API);
    expect(curlLog(fixture)).not.toContain(HOOK_WORKER);
  });

  it("W3-DEPLOY-T4 (D70): release.sh refuses before any hook without APP_ORIGIN, and for a tag with no migration files", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, "a.txt");
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "v1.0.0"]);

    const noOrigin = runRelease(fixture, ["v1.0.0"], {
      RENDER_DEPLOY_HOOK_API: HOOK_API,
      RENDER_DEPLOY_HOOK_WORKER: HOOK_WORKER,
    });
    expect(noOrigin.status).toBe(2);
    expect(noOrigin.stderr).toContain("release_origin_missing");

    // Without a migration file the script cannot know the schema version the worker of this tag expects.
    const noMigrations = runRelease(fixture, ["v1.0.0"], FULL_ENV);
    expect(noMigrations.status).toBe(2);
    expect(noMigrations.stderr).toContain("release_schema_unknown");
    expect(curlLog(fixture)).toBe("");
  });

  it("W3-DEPLOY-T9 (D70): with RENDER_DEPLOY_HOOK set for the one service, release.sh calls that hook once with the tag's commit and nothing else", () => {
    const fixture = makeFixture();
    commitFile(fixture.repo, FIRST_MIGRATION);
    git(fixture.repo, ["push", "-q", "origin", "main:release"]);
    git(fixture.repo, ["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"]);

    const result = runRelease(fixture, ["v1.0.0"], { RENDER_DEPLOY_HOOK: HOOK_ONE });

    expect(result.status).toBe(0);
    const commit = gitOutput(fixture.repo, ["rev-parse", "v1.0.0^{commit}"]);
    // The one service's start script migrates before either process starts, so no health read sits between hooks.
    const lines = curlLog(fixture).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`${HOOK_ONE}&ref=${commit}`);
  });
});
