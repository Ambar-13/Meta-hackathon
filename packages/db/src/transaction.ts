import { sql, type Kysely, type Transaction } from "kysely";
import { ContractError, Uuid } from "@meet-first/contracts";
import type { Database } from "./types.js";

// The transaction the two wrappers hand to run; every query inside it sees exactly one context.
export type DatabaseTransaction = Transaction<Database>;

// Refuses an id that is not a uuid before any transaction opens; the label names which id it was.
function assertUuid(id: string, label: "person" | "meeting"): void {
  if (Uuid.safeParse(id).success) return;
  throw new ContractError("context_id_invalid", `The ${label} id passed to withPerson or withMeeting is not a uuid. Pass the row id, not a token.`, 500);
}

// Refuses a transaction that would carry both settings or neither; a programming error, caught before any row is read (ARCHITECTURE.md 7.1).
export async function assertOneContext(trx: DatabaseTransaction): Promise<void> {
  const result = await sql<{ person: string | null; meeting: string | null }>`
    SELECT nullif(current_setting('app.person_id', true), '') AS person,
           nullif(current_setting('app.meeting_id', true), '') AS meeting`.execute(trx);
  const row = result.rows[0] ?? { person: null, meeting: null };
  if (row.person !== null && row.meeting !== null) throw new ContractError("context_both_set", "A transaction set both app.person_id and app.meeting_id. Use withPerson or withMeeting, not both.", 500);
  if (row.person === null && row.meeting === null) throw new ContractError("context_missing", "A transaction set neither app.person_id nor app.meeting_id. Wrap the work in withPerson or withMeeting.", 500);
}

// Runs run inside one transaction as this person: BEGIN; SET LOCAL app.person_id; run; COMMIT (D55). A throw rolls back.
export async function withPerson<T>(db: Kysely<Database>, personId: string, run: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
  assertUuid(personId, "person");
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.person_id', ${personId}, true)`.execute(trx);
    await assertOneContext(trx);
    return run(trx);
  });
}

// Runs run inside one transaction as this meeting: BEGIN; SET LOCAL app.meeting_id; run; COMMIT (D55). Meeting jobs use this, never withPerson.
export async function withMeeting<T>(db: Kysely<Database>, meetingId: string, run: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
  assertUuid(meetingId, "meeting");
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.meeting_id', ${meetingId}, true)`.execute(trx);
    await assertOneContext(trx);
    return run(trx);
  });
}
