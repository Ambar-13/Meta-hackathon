import { sql, type Kysely } from "kysely";
import { numberFromPostgres } from "../client.js";
import { withMeeting, withPerson, type DatabaseTransaction } from "../transaction.js";
import type { Database } from "../types.js";

// Runs run as this person: the same as withPerson, named for tests.
export function asPerson<T>(db: Kysely<Database>, personId: string, run: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return withPerson(db, personId, run);
}

// Runs run as this meeting: the same as withMeeting, named for tests.
export function asMeeting<T>(db: Kysely<Database>, meetingId: string, run: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return withMeeting(db, meetingId, run);
}

// Runs run in a transaction with both settings set to empty, so every policy sees no person and no meeting.
export async function withNoContext<T>(db: Kysely<Database>, run: (trx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.person_id', '', true), set_config('app.meeting_id', '', true)`.execute(trx);
    return run(trx);
  });
}

// How many rows of one table or view the current context can see.
export async function countVisibleRows(trx: DatabaseTransaction, table: keyof Database): Promise<number> {
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(trx);
  return numberFromPostgres(result.rows[0]?.n);
}
