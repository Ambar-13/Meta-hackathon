import { expect, it } from "vitest";
import { MEETING_OVERTIME_GRACE_MS, MEETING_STEP_MAX_ATTEMPTS, STEP_CLAIM_FRESH_MS, stallAction, type SweptStep } from "./sweep-stalled-job.js";

// The moment the sweep runs in these tests.
const NOW = new Date("2026-10-27T10:00:00.000Z");

// The moment ms before NOW.
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

// The sweep's choice for this step, in a meeting whose end time is still a minute away.
function actionFor(step: SweptStep | undefined): string {
  return stallAction({ endsAt: new Date(NOW.getTime() + 60_000), step }, NOW);
}

it("W3-WORK-T8: the attempt limit, the claim window and the overtime grace apply at their edges, and a pending step always gets a new job", () => {
  expect([MEETING_STEP_MAX_ATTEMPTS, MEETING_OVERTIME_GRACE_MS, STEP_CLAIM_FRESH_MS]).toEqual([3, 120_000, 360_000]);
  expect(actionFor({ state: "stalled", attempt: 2, claimedAt: ago(1_000) })).toBe("enqueue");
  expect(actionFor({ state: "stalled", attempt: 3, claimedAt: ago(1_000) })).toBe("end");
  // A step the limiter sent back to pending is waiting for room, not failing, so its attempts do not end the meeting.
  expect(actionFor({ state: "pending", attempt: 5, claimedAt: ago(1_000) })).toBe("enqueue");
  expect(actionFor({ state: "pending", attempt: 0, claimedAt: null })).toBe("enqueue");
  expect(actionFor({ state: "running", attempt: 1, claimedAt: ago(STEP_CLAIM_FRESH_MS - 1) })).toBe("skip");
  expect(actionFor({ state: "running", attempt: 1, claimedAt: ago(STEP_CLAIM_FRESH_MS) })).toBe("enqueue");
  expect(actionFor({ state: "running", attempt: 3, claimedAt: ago(STEP_CLAIM_FRESH_MS) })).toBe("end");
  expect(actionFor({ state: "running", attempt: 1, claimedAt: null })).toBe("enqueue");
  expect(actionFor({ state: "done", attempt: 1, claimedAt: ago(1_000) })).toBe("skip");
  expect(actionFor(undefined)).toBe("skip");
  // Past the grace the meeting ends even while a runner holds a fresh claim; at the grace exactly it does not.
  const held: SweptStep = { state: "running", attempt: 1, claimedAt: ago(1_000) };
  expect(stallAction({ endsAt: ago(MEETING_OVERTIME_GRACE_MS), step: held }, NOW)).toBe("skip");
  expect(stallAction({ endsAt: ago(MEETING_OVERTIME_GRACE_MS + 1), step: held }, NOW)).toBe("end");
  expect(stallAction({ endsAt: null, step: held }, NOW)).toBe("skip");
});
