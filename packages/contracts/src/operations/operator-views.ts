import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";
import { CommittedEvent } from "../meetings/events.js";

// What GET /api/health returns to an operator or to the uptime check.
export const Health = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  worker: z.boolean(),
  schemaVersion: z.number().int(),
  diskPct: z.number().min(0).max(100).nullable(),
  degraded: z.boolean(),
});
export type Health = z.infer<typeof Health>;
// Disk use above this percentage marks the service as degraded.
export const DISK_DEGRADED_PCT = 80;
// A meeting's events exported for replay in the browser, with the time of the export.
export const ReplayExport = z.object({
  meetingId: Uuid,
  exportedAt: IsoTime,
  events: z.array(CommittedEvent),
});
export type ReplayExport = z.infer<typeof ReplayExport>;
// What DELETE /api/people/me returns: the id of the deletion record.
export const DeletionResponse = z.object({ deletionId: Uuid });
export type DeletionResponse = z.infer<typeof DeletionResponse>;
