// The seven Vitest projects, one per test kind (design-inputs/repo-structure-rules.md "Tests and migrations").
import { defineWorkspace } from "vitest/config";

const KINDS = ["unit", "contracts", "integration", "journeys", "accessibility", "security", "reliability"] as const;
const NEEDS_POSTGRES = new Set(["integration", "journeys", "security", "reliability"]);

// The default export lists the seven projects, one for each test kind.
export default defineWorkspace(
  KINDS.map((kind) => ({
    test: {
      name: kind,
      include: [`{apps,packages}/*/src/**/*.${kind}.test.{ts,tsx}`, `scripts/**/*.${kind}.test.ts`, `tests/${kind}/**/*.test.ts`],
      environment: kind === "accessibility" ? "jsdom" : "node",
      globalSetup: NEEDS_POSTGRES.has(kind) ? ["packages/db/src/testing/fresh-database.ts"] : [],
      testTimeout: kind === "reliability" ? 120_000 : 20_000,
      hookTimeout: 60_000,
      pool: "forks",
      poolOptions: { forks: { singleFork: NEEDS_POSTGRES.has(kind) } },
    },
  })),
);
