import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CALL_SITES } from "../operations/model-calls.js";
import { CATEGORIES } from "../sources/scrub-categories.js";
import { COMMITTED_EVENT_TYPES, CommittedEvent, MeetingEvent, eventToPayload, rowToEvent } from "./events.js";

const MIGRATION_FILE = fileURLToPath(new URL("../../../db/migrations/0001_foundation.sql", import.meta.url));
const MEETING_ID = "0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11";
const CLAIM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const AT = "2026-10-27T08:00:00.000Z";
const BASE = { v: 1, meetingId: MEETING_ID, at: AT };

/** The quoted names inside one SQL CHECK list, such as the names of the type column. */
function checkNames(sql: string, pattern: RegExp): string[] {
  const list = pattern.exec(sql)?.[1] ?? "";
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? "");
}

const COMMITTED_SAMPLES: unknown[] = [
  { ...BASE, seq: 1, type: "meeting.started", startedAt: AT, endsAt: AT, question: "Who decides?", members: [{ side: "a", displayName: "Ann" }, { side: "b", displayName: "Bo" }] },
  { ...BASE, seq: 2, type: "phase.changed", phase: "open", stepSeq: 1 },
  { ...BASE, seq: 3, type: "turn.committed", stepSeq: 1, side: "a", phase: "open", text: "Hello.", claims: [] },
  { ...BASE, seq: 4, type: "tool.called", stepSeq: 1, side: "a", tool: "recall", args: { query: "rent" } },
  { ...BASE, seq: 5, type: "tool.result", stepSeq: 1, side: "a", tool: "recall", result: { turns: [] } },
  { ...BASE, seq: 6, type: "concede", stepSeq: 3, side: "b", claimId: CLAIM_ID, reason: "Fair point." },
  { ...BASE, seq: 7, type: "hold", stepSeq: 3, side: "a", reason: "Still my view." },
  { ...BASE, seq: 8, type: "meeting.ended", reason: "decided", endedAt: AT },
  { ...BASE, seq: 9, type: "brief.ready", supportRate: { a: null, b: null } },
  { ...BASE, seq: 10, type: "comic.ready", comicId: MEETING_ID },
  { ...BASE, seq: 11, type: "comic.skipped", comicId: MEETING_ID, reason: "panel too large" },
];

describe("meeting events", () => {
  it("R5.11-T1: every committed event carries v, seq, meetingId and at", () => {
    const results = COMMITTED_SAMPLES.map((sample) => CommittedEvent.safeParse(sample));

    expect(COMMITTED_SAMPLES).toHaveLength(11);
    expect(results.map((result) => result.success)).toEqual(COMMITTED_SAMPLES.map(() => true));
  });

  it("R5.11-T2: turn.delta has no seq and parses in MeetingEvent but not CommittedEvent", () => {
    const delta = { ...BASE, type: "turn.delta", stepSeq: 3, attempt: 1, side: "b", offset: 0, text: "Well" };

    expect(MeetingEvent.safeParse(delta).success).toBe(true);
    expect(CommittedEvent.safeParse(delta).success).toBe(false);
  });

  it("R13.2-T1: COMMITTED_EVENT_TYPES equals the CHECK list in 0001", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf8");

    const names = checkNames(sql, /type text NOT NULL CHECK \(type IN \(([^)]*)\)\)/);

    expect([...names].sort()).toEqual([...COMMITTED_EVENT_TYPES].sort());
    expect(COMMITTED_EVENT_TYPES).toHaveLength(11);
  });

  it("R13.2-T2: CALL_SITES equals the ledger call_site CHECK list in 0001", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf8");

    const names = checkNames(sql, /call_site text NOT NULL CHECK \(call_site IN \(([^)]*)\)\)/);

    expect([...names].sort()).toEqual([...CALL_SITES].sort());
    expect(CALL_SITES).toHaveLength(12);
  });

  it("R13.2-T3: CATEGORIES equals the redactions category CHECK list in 0001", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf8");

    const names = checkNames(sql, /category text NOT NULL CHECK \(category IN \(([^)]*)\)\)/);

    expect([...names].sort()).toEqual([...CATEGORIES].sort());
    expect(CATEGORIES).toHaveLength(17);
  });

  it("R5.2-T1: every committed event survives eventToPayload and rowToEvent unchanged", () => {
    const events = COMMITTED_SAMPLES.map((sample) => CommittedEvent.parse(sample));

    const rebuilt = events.map((event) =>
      rowToEvent({ meeting_id: event.meetingId, seq: event.seq, type: event.type, v: event.v, payload: eventToPayload(event), created_at: new Date(event.at) }),
    );

    expect(rebuilt).toEqual(events);
    expect(Object.keys(eventToPayload(events[1] ?? CommittedEvent.parse(COMMITTED_SAMPLES[1])))).toEqual(["phase", "stepSeq"]);
  });

  it("R5.2-T2: rowToEvent refuses a stored row that no longer matches its schema", () => {
    const row = { meeting_id: MEETING_ID, seq: 2, type: "phase.changed", v: 1, payload: { phase: "lunch", stepSeq: 1 }, created_at: AT };

    expect(() => rowToEvent(row)).toThrowError(expect.objectContaining({ code: "event_row_invalid", httpStatus: 500 }) as Error);
  });
});
