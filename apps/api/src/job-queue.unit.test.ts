import type { WorkerUtils } from "graphile-worker";
import { expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import { makeApiEnqueue } from "./job-queue.js";

const U = "0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11";

type AddedJob = { name: string; payload: unknown; spec: Record<string, unknown> };

// A fake Graphile queue: it records each addJob call and returns the result the test gives it.
function fakeWorkerUtils(result: unknown): { utils: WorkerUtils; calls: AddedJob[] } {
  const calls: AddedJob[] = [];
  const utils = {
    addJob: (name: string, payload: unknown, spec: Record<string, unknown>) => {
      calls.push({ name, payload, spec });
      return Promise.resolve(result);
    },
  };
  return { utils: utils as unknown as WorkerUtils, calls };
}

// The call at one position, or a loud failure when the test expected a call that never came.
function callAt(calls: AddedJob[], position: number): AddedJob {
  const call = calls[position];
  if (call === undefined) {
    throw new Error(`expected at least ${String(position + 1)} addJob call(s)`);
  }
  return call;
}

it("D45-T1: makeApiEnqueue passes maxAttempts from JOB_MAX_ATTEMPTS and no job key when none is given (uses a fake WorkerUtils)", async () => {
  const { utils, calls } = fakeWorkerUtils({ id: "1" });

  await makeApiEnqueue(utils)("delete_person", { personId: U });

  expect(calls.length).toBe(1);
  expect(callAt(calls, 0)).toEqual({
    name: "delete_person",
    payload: { personId: U },
    spec: { maxAttempts: 5 },
  });
  expect(Object.keys(callAt(calls, 0).spec)).toEqual(["maxAttempts"]);
});

it("D45-T3: maxAttempts follows JOB_MAX_ATTEMPTS, 2 for build_card and 1 for meeting_step (uses a fake WorkerUtils)", async () => {
  const { utils, calls } = fakeWorkerUtils({ id: "1" });
  const enqueue = makeApiEnqueue(utils);

  await enqueue("build_card", { cardId: U, personId: U });
  await enqueue("meeting_step", { meetingId: U, stepSeq: 1 });

  expect(callAt(calls, 0).spec.maxAttempts).toBe(2);
  expect(callAt(calls, 1).spec).toEqual({ maxAttempts: 1 });
});

it("D45-T4: a null from addJob is enqueue_failed (uses a fake WorkerUtils)", async () => {
  const { utils } = fakeWorkerUtils(null);
  const enqueue = makeApiEnqueue(utils);

  const attempt = enqueue("delete_person", { personId: U });

  await expect(attempt).rejects.toBeInstanceOf(ContractError);
  await expect(attempt).rejects.toMatchObject({
    code: "enqueue_failed",
    message: "The job queue did not accept the job. Retry the request.",
    httpStatus: 400,
  });
});
