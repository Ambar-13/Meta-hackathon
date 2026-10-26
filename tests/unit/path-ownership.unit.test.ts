// Tests for scripts/path-ownership.ts against the real scripts/ownership-map.json.
// A branch named build/w<wave>-<builder> may touch only its builder's globs plus the always-allowed paths.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findForeignPaths, type OwnershipMap } from "../../scripts/path-ownership.js";

const MAP_FILE = join(import.meta.dirname, "..", "..", "scripts", "ownership-map.json");
const map: OwnershipMap = JSON.parse(readFileSync(MAP_FILE, "utf8")) as OwnershipMap;

// Paths from IMPLEMENTATION.md section 1, the repository layout, one entry per file or folder the wave-2 builders own or touch.
const LAYOUT_PATHS: readonly string[] = [
  "apps/web/src/screens/brief/screen.tsx",
  "apps/web/src/screens/comic/screen.tsx",
  "apps/web/src/screens/share/public-page.tsx",
  "apps/web/src/screens/settings/screen.tsx",
  "apps/web/src/app-shell/routes.tsx",
  "apps/api/src/server.ts",
  "apps/api/src/sessions/delete-person.ts",
  "apps/api/src/briefs/read-brief.ts",
  "apps/api/src/comics/request-comic.ts",
  "apps/api/src/share/give-consent.ts",
  "apps/worker/src/runner.ts",
  "apps/worker/src/briefs/write-briefs-job.ts",
  "apps/worker/src/comics/render-comic-job.ts",
  "apps/worker/src/retention/delete-person-job.ts",
  "apps/worker/src/meetings/step-job.ts",
  "packages/contracts/src/operations/env.ts",
  "packages/db/src/transaction.ts",
  "packages/llm/src/client.ts",
  "packages/prompts/brief/v1/prompt.md",
  "packages/prompts/comic-panels/v1/prompt.md",
  "packages/prompts/src/current.ts",
  "packages/evals/src/run-eval.ts",
  "scripts/golden-path.ts",
  "scripts/share-takedown.ts",
  "render.yaml",
  "Dockerfile.api",
  "scripts/release.sh",
  "docs/architecture/OVERVIEW.md",
  "README.md",
  "tests/unit/release-script.unit.test.ts",
];

describe("path ownership", () => {
  it("W2-DEPLOY-T4 (R13.1): a diff touching a path outside the builder's set is reported and exits 1", () => {
    const result = findForeignPaths({
      branch: "build/w2-briefs",
      changedPaths: ["apps/worker/src/briefs/x.ts", "apps/api/src/server.ts"],
      map,
    });

    expect(result.builder).toBe("briefs");
    expect(result.foreign).toEqual(["apps/api/src/server.ts"]);
  });

  it("W2-DEPLOY-T5 (R13.1): requests and the builder's own model-replies are always allowed; negated globs exclude the frozen schema", () => {
    const result = findForeignPaths({
      branch: "build/w2-briefs",
      changedPaths: ["requests/build-w2-briefs-001.md", "packages/prompts/brief/v1/schema.json"],
      map,
    });

    expect(result.foreign).toEqual(["packages/prompts/brief/v1/schema.json"]);
  });

  it("W2-DEPLOY-T6: main and release skip; an unknown builder fails", () => {
    expect(findForeignPaths({ branch: "main", changedPaths: ["apps/api/src/server.ts"], map }).builder).toBeNull();
    expect(findForeignPaths({ branch: "release", changedPaths: ["render.yaml"], map }).builder).toBeNull();
    expect(() => findForeignPaths({ branch: "build/w2-nobody", changedPaths: ["README.md"], map })).toThrow(
      /path_ownership_unknown_builder/,
    );
  });

  it("W2-DEPLOY-T7: every path in IMPLEMENTATION.md section 1 layout is owned by exactly one builder in w2 or is frozen", () => {
    const wave2Builders = Object.keys(map.waves.w2 ?? {});
    const ownersOf = (path: string): string[] =>
      wave2Builders.filter(
        (builder) => findForeignPaths({ branch: `build/w2-${builder}`, changedPaths: [path], map }).foreign.length === 0,
      );
    const doubleOwned = LAYOUT_PATHS.map((path) => ({ path, owners: ownersOf(path) })).filter((row) => row.owners.length > 1);
    expect(doubleOwned).toEqual([]);
  });
});
