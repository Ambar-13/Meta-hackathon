import { sql } from "kysely";
import { ContractError, JobPayloads } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { JobTask } from "../job-context.js";
import { countPersonRows } from "./table-list.js";

// Reads the person id from the payload with the contracts schema; anything else is refused with its own code.
function readPersonId(payload: unknown): string {
  const parsed = JobPayloads.delete_person.safeParse(payload);
  if (!parsed.success) throw new ContractError("delete_person_bad_payload", "The job payload is not `{personId}`. Check the enqueue in the delete route.");
  return parsed.data.personId;
}

// Marks every meeting the person is in as deleted, so a step that wakes up finds it gone and exits.
async function markMeetingsDeleted(trx: DatabaseTransaction, personId: string, now: Date): Promise<void> {
  const rows = await trx.selectFrom("meeting_members").select("meeting_id").where("person_id", "=", personId).execute();
  const meetingIds = rows.map((row) => row.meeting_id);
  if (meetingIds.length === 0) return;
  await trx.updateTable("meetings").set({
    state: "deleted",
    ended_at: sql`coalesce(ended_at, ${now})`,
    end_reason: sql`coalesce(end_reason, 'deleted')`,
  }).where("id", "in", meetingIds).where("state", "<>", "deleted").execute();
}

// True when the database refused a delete because a foreign key still points at the row (SQLSTATE 23503).
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "23503";
}

// Deletes the people row in one statement, so every foreign key cascades through the person's tables.
async function deletePersonRow(trx: DatabaseTransaction, personId: string): Promise<void> {
  try {
    await trx.deleteFrom("people").where("id", "=", personId).execute();
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new ContractError("delete_person_cascade_blocked", "A table references people without ON DELETE CASCADE. Add it in a migration; see the error detail for the table.", 500);
    }
    throw error;
  }
}

// Completes the deletions row the route wrote, or writes it when the route did not. A row already complete is left alone, so a second run adds nothing.
async function finishDeletionRecord(trx: DatabaseTransaction, outcome: { personId: string; counts: Record<string, number>; now: Date }): Promise<void> {
  const { personId, now } = outcome;
  const record = JSON.stringify(outcome.counts);
  const completed = await trx.updateTable("deletions").set({ completed_at: now, counts: record }).where("person_id", "=", personId).where("completed_at", "is", null).returning("id").execute();
  if (completed.length > 0) return;
  const existing = await trx.selectFrom("deletions").select("id").where("person_id", "=", personId).executeTakeFirst();
  if (existing !== undefined) return;
  await trx.insertInto("deletions").values({ person_id: personId, requested_at: now, completed_at: now, counts: record }).execute();
}

// The delete_person job: marks the person and their meetings deleted, counts the rows, deletes the people row so the foreign keys cascade, and records the counts.
export const deletePersonTask: JobTask<"delete_person"> = async (payload, context) => {
  const personId = readPersonId(payload);
  await withPerson(context.db, personId, async (trx) => {
    const now = context.now();
    const person = await trx.selectFrom("people").select(["id", "state"]).where("id", "=", personId).executeTakeFirst();
    if (person === undefined) {
      await finishDeletionRecord(trx, { personId, counts: {}, now });
      return;
    }
    if (person.state !== "deleted") {
      await trx.updateTable("people").set({ state: "deleted", deleted_at: now }).where("id", "=", personId).execute();
    }
    await markMeetingsDeleted(trx, personId, now);
    const counts = await countPersonRows(trx, personId);
    await deletePersonRow(trx, personId);
    await finishDeletionRecord(trx, { personId, counts, now });
  });
};
