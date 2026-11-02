// Unit tests for the golden path: the command-line flags and step selection, and the database read that compiles a placeholder count.
import { describe, expect, it } from "vitest";
import { makeDatabase } from "@meet-first/db";
import { parseFlags, selectSteps } from "./flags.js";
import { placeholderCountQuery } from "./database-reads.js";
import type { RunState } from "./report.js";
import { step05Quiz } from "./steps-quiz-approve-pair.js";

// Runs a function and returns the error it threw, or undefined when it did not throw.
function catchError(run: () => unknown): Error | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe("golden path flags", () => {
  it("golden-path-T1: --until brief selects steps 1 to 12", () => {
    const names = selectSteps("brief").map((step) => step.name);
    expect(names).toHaveLength(12);
    expect(names[names.length - 1]).toBe("decide");
  });

  it("golden-path-T3 (design section 9): the directory, friend ask and help steps come after the share step, and the deletion is last", () => {
    const names = selectSteps(undefined).map((step) => step.name);
    expect(names).toHaveLength(24);
    expect(names.slice(14)).toEqual(["share", "sharing", "directory", "dir-decide", "dir-brief", "friend-ask", "help", "friend-request", "orchestrator", "delete"]);
  });

  it("golden-path-T2: --live with --mock exits 2", () => {
    const caught = catchError(() => parseFlags(["--live", "--mock"]));
    expect(caught).toMatchObject({ exitCode: 2 });
    expect(caught?.message).toMatch(/^golden_path_flags_conflict/);
  });

  it("golden-path-T4 (wave 3 section 4.4): --record runs in record mode, and --record with --mock exits 2", () => {
    expect(parseFlags(["--record"]).mode).toBe("record");
    const caught = catchError(() => parseFlags(["--record", "--mock"]));
    expect(caught).toMatchObject({ exitCode: 2 });
    expect(caught?.message).toMatch(/^golden_path_flags_conflict/);
  });

  it("golden-path-T5 (wave 3 section 4.4): the quiz is not exercised under --record, so the recording follows the --mock path", async () => {
    const result = await step05Quiz({ options: { mode: "record" } } as RunState);
    expect(result).toMatchObject({ number: 5, result: "not-exercised" });
  });
});

describe("database reads", () => {
  it("R2.5-T1: countPlaceholders SQL counts two placeholders in one turn", () => {
    const db = makeDatabase("postgres://app_worker:unused@localhost:5432/meet_first_unit", 1);
    const sql = placeholderCountQuery(db, "0f8c7a52-4d3e-4b8a-9c1e-2a3b4c5d6e7f").compile().sql;
    // The marker is passed as a bound value, so the compiled text differs from the spec's literal form only in those values.
    expect(sql).toBe('select coalesce(sum((length("text") - length(replace("text", $1, $2))) / length($3)), 0) as "count" from "turns" where "source_id" = $4');
    void db.destroy();
  });
});
