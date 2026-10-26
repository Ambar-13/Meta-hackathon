import { describe, expect, it } from "vitest";
import { CRONTAB } from "@meet-first/contracts";
import { makeDatabase } from "@meet-first/db";
import { testWorkerVariables } from "@meet-first/llm/testing";
import { crontabForTasks, describeBootError, graphileTaskList, startWorker, TASKS } from "./runner.js";
import type { TaskList } from "./job-context.js";
import { makeTestJobContext } from "./testing/index.js";

// A task list with a no-op task for each of the given job names.
function taskList(names: string[]): TaskList {
  return Object.fromEntries(names.map((name) => [name, () => Promise.resolve()])) as TaskList;
}

describe("the worker boot", () => {
  it("R10.2-T2: startWorker refuses a missing DATABASE_URL_WORKER and the boot line names it", async () => {
    const error = await startWorker(testWorkerVariables("replay", { DATABASE_URL_WORKER: "" })).catch((caught: unknown) => caught);
    expect(describeBootError(error)).toBe("env_invalid: DATABASE_URL_WORKER");
  });

  it("D74-T7: startWorker refuses replay in production before it opens the database", async () => {
    const error = await startWorker(testWorkerVariables("replay", { DATABASE_URL_WORKER: "postgres://unused:unused@127.0.0.1:1/unused", NODE_ENV: "production" })).catch((caught: unknown) => caught);
    expect(describeBootError(error).startsWith("llm_mode_replay_in_production:")).toBe(true);
  });

  it("D46-T1: the crontab keeps only the lines whose task is registered", () => {
    expect(crontabForTasks({})).toBe("");
    expect(crontabForTasks(taskList(["sweep_stalled"]))).toBe("* * * * * sweep_stalled ?max=1");
    expect(crontabForTasks(taskList(["sweep_stalled", "purge_expired"]))).toBe(CRONTAB.split("\n").filter((line) => line.length > 0).join("\n"));
  });

  it("R13.3-T2: the runner registers the names pass and the card build", () => {
    expect(typeof TASKS.scrub_names).toBe("function");
    expect(typeof TASKS.build_card).toBe("function");
    const { context } = makeTestJobContext({ db: makeDatabase("postgres://unused:unused@127.0.0.1:1/unused", 1) });
    expect(Object.keys(graphileTaskList(TASKS, context)).slice(0, 2)).toEqual(["scrub_names", "build_card"]);
  });
});
