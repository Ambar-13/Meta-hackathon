Request build/w0-contracts-002.
File: packages/contracts/src/meetings/events.ts (new export rowToEvent).
Change wanted: the spec says readers rebuild the full event with rowToEvent(row) exported from this file, but it gives no signature and no row shape. Proposed, not applied:
```diff
+export type MeetingEventRow = { type: string; v: number; payload: Record<string, unknown>; meetingId: string; seq: number; createdAt: string };
+// Rebuilds the full committed event from one meeting_events row; createdAt becomes at.
+export function rowToEvent(row: MeetingEventRow): CommittedEvent { ... }
```
Why: no Wave 0 test names rowToEvent. Wave 1 readers (the meeting engine and the replay export) need it, and the created_at column has to map to at.
Until then: rowToEvent is not exported. Nothing in Wave 0 calls it.
Resolved at the Wave 0 freeze, 26 Oct: rowToEvent(row: MeetingEventRow) and eventToPayload(event) are in meetings/events.ts; writers store created_at = event.at.
