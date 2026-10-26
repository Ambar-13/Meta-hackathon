import { describe, expect, it, vi } from "vitest";
import type { WorkerUtils } from "graphile-worker";
import { ContractError, JOB_MAX_ATTEMPTS } from "@meet-first/contracts";
import { LimiterBusy } from "@meet-first/llm";
import { makeDatabase } from "@meet-first/db";
import { definePayloadTask, makeEnqueue, type JobTask } from "./job-context.js";
import { makeTestJobContext } from "./testing/index.js";

const sourceId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-27T10:00:00.000Z");

// A database handle that never connects: these tests do not read the database.
function unusedDb(): ReturnType<typeof makeDatabase> {
  return makeDatabase("postgres://unused:unused@127.0.0.1:1/unused", 1);
}

// A fake worker utils whose addJob records its arguments and returns what the test gives.
function fakeWorkerUtils(result: unknown): { utils: WorkerUtils; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const utils = {
    addJob: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
  return { utils: utils as unknown as WorkerUtils, calls };
}

describe("makeEnqueue", () => {
  it("D45-T1: makeEnqueue always passes JOB_MAX_ATTEMPTS, adds runAt only when given, and never a job key (fake worker utils)", async () => {
    const { utils, calls } = fakeWorkerUtils({ id: "1" });
    const enqueue = makeEnqueue(utils);
    await enqueue("build_card", { cardId: sourceId, personId });
    await enqueue("meeting_step", { meetingId: personId, stepSeq: 1 }, { runAt: new Date("2026-10-27T10:01:30.000Z") });
    expect(calls[0]?.[2]).toEqual({ maxAttempts: JOB_MAX_ATTEMPTS.build_card });
    expect(calls[0]?.[2]).toEqual({ maxAttempts: 2 });
    expect(calls[1]?.[2]).toEqual({ maxAttempts: JOB_MAX_ATTEMPTS.meeting_step, runAt: new Date("2026-10-27T10:01:30.000Z") });
  });

  it("D45-T2: a null from addJob throws enqueue_failed (fake worker utils)", async () => {
    const { utils } = fakeWorkerUtils(null);
    const error = await makeEnqueue(utils)("build_card", { cardId: sourceId, personId }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContractError);
    expect(error).toMatchObject({ code: "enqueue_failed" });
  });
});

describe("definePayloadTask", () => {
  it("D55-T1: the task wrapper keeps personId and strips unknown keys (fake task)", async () => {
    const { context } = makeTestJobContext({ db: unusedDb(), now: () => NOW });
    const received: unknown[] = [];
    const task: JobTask<"scrub_names"> = (payload) => {
      received.push(payload);
      return Promise.resolve();
    };
    await definePayloadTask("scrub_names", task, context)({ sourceId, personId, extra: 1 });
    expect(received).toEqual([{ sourceId, personId }]);
  });

  it("R13.3-T1: a payload that fails its schema is logged once and never thrown (fake task)", async () => {
    const { context } = makeTestJobContext({ db: unusedDb(), now: () => NOW });
    const errorSpy = vi.spyOn(context.log, "error");
    let calls = 0;
    const task: JobTask<"scrub_names"> = () => {
      calls += 1;
      return Promise.resolve();
    };
    await expect(definePayloadTask("scrub_names", task, context)({ sourceId: "not-a-uuid", personId })).resolves.toBeUndefined();
    expect(calls).toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[1]).toBe("job_payload_invalid");
  });

  it("D58-T5: a task that throws LimiterBusy is re-enqueued at now + 5 s and the wrapper does not throw (fake task, fake clock)", async () => {
    const { context, enqueued } = makeTestJobContext({ db: unusedDb(), now: () => NOW });
    const task: JobTask<"build_card"> = () => Promise.reject(new LimiterBusy(0));
    await expect(definePayloadTask("build_card", task, context)({ cardId: sourceId, personId })).resolves.toBeUndefined();
    expect(enqueued).toEqual([{ name: "build_card", payload: { cardId: sourceId, personId }, options: { runAt: new Date("2026-10-27T10:00:05.000Z") } }]);
  });

  it("D59-T11: any other task error is thrown, so Graphile's attempts apply (fake task)", async () => {
    const { context } = makeTestJobContext({ db: unusedDb(), now: () => NOW });
    const task: JobTask<"build_card"> = () => Promise.reject(new Error("boom"));
    await expect(definePayloadTask("build_card", task, context)({ cardId: sourceId, personId })).rejects.toThrow("boom");
  });
});
