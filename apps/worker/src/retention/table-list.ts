import { sql, type RawBuilder } from "kysely";
import { numberFromPostgres, type DatabaseTransaction } from "@meet-first/db";

// One table where a person's rows live, and how the rows are reached (ARCHITECTURE.md 3.23, invariant 16).
export type PersonTable =
  | { table: string; reach: "person_id" } // a person_id column (people counts by id)
  | { table: string; reach: "pair_person"; columns: ["creator_person_id", "joiner_person_id"] } // a pair the person created or joined
  | { table: string; reach: "answer_person"; columns: ["asker_person_id", "subject_person_id"] } // a persona answer the person asked for or gave
  | { table: string; reach: "meeting_id" } // joint rows that go when the meeting goes (meetings counts by id)
  | { table: string; reach: "comic_id" } // comic_panels, through comics.meeting_id
  | { table: string; reach: "ledger_nulled" } // ledger: person_id goes null and the rows stay (D69)
  | { table: string; reach: "record" }; // deletions: the record of the deletion itself, never counted

// The tables that are counted: every table here except the record of the deletion.
type CountableTable = Exclude<PersonTable, { reach: "record" }>;

// Every table that holds a person's rows, and how each is reached. The coverage test fails when a table with a person_id is missing here.
export const PERSON_TABLES: readonly PersonTable[] = [
  { table: "sessions", reach: "person_id" },
  { table: "transfer_links", reach: "person_id" },
  { table: "sources", reach: "person_id" },
  { table: "turns", reach: "person_id" },
  { table: "redactions", reach: "person_id" },
  { table: "cards", reach: "person_id" },
  { table: "card_items", reach: "person_id" },
  { table: "quizzes", reach: "person_id" },
  { table: "quiz_items", reach: "person_id" },
  { table: "names_passes", reach: "person_id" },
  { table: "source_names", reach: "person_id" },
  { table: "pairs", reach: "pair_person", columns: ["creator_person_id", "joiner_person_id"] },
  { table: "meetings", reach: "meeting_id" },
  { table: "meeting_members", reach: "meeting_id" },
  { table: "meeting_steps", reach: "meeting_id" },
  { table: "meeting_events", reach: "meeting_id" },
  { table: "claims", reach: "meeting_id" },
  { table: "briefs", reach: "meeting_id" },
  { table: "comics", reach: "meeting_id" },
  { table: "comic_panels", reach: "comic_id" },
  { table: "share_pages", reach: "meeting_id" },
  { table: "directory_listings", reach: "person_id" },
  { table: "persona_asks", reach: "person_id" },
  { table: "persona_answers", reach: "answer_person", columns: ["asker_person_id", "subject_person_id"] },
  { table: "ledger", reach: "ledger_nulled" },
  { table: "deletions", reach: "record" },
  { table: "people", reach: "person_id" },
];

// What one count needs: the transaction, the person and the ids of the person's meetings, read once.
type CountScope = { trx: DatabaseTransaction; personId: string; meetingIds: string[] };

// Counts the rows each table will lose for this person, inside the person's own transaction. Joint tables count every row of the person's meetings, because those rows go for both members (R9.7),
// except briefs: the person's transaction sees only their own brief (as-built item 1), so the other member's brief goes with the meeting without being counted here.
export async function countPersonRows(trx: DatabaseTransaction, personId: string): Promise<Record<string, number>> {
  const rows = await trx.selectFrom("meeting_members").select("meeting_id").where("person_id", "=", personId).execute();
  const scope: CountScope = { trx, personId, meetingIds: rows.map((row) => row.meeting_id) };
  const counts: Record<string, number> = {};
  for (const entry of PERSON_TABLES) {
    if (entry.reach === "record") continue;
    const key = entry.reach === "ledger_nulled" ? "ledger_nulled" : entry.table;
    counts[key] = await countEntry(scope, entry);
  }
  return counts;
}

// The rows of one table that belong to the person, counted with the condition its reach gives.
async function countEntry(scope: CountScope, entry: CountableTable): Promise<number> {
  const condition = conditionFor(scope, entry);
  if (condition === null) return 0;
  const result = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(entry.table)} WHERE ${condition}`.execute(scope.trx);
  return numberFromPostgres(result.rows[0]?.n);
}

// The WHERE of one count, or null when the reach needs a meeting and the person has none.
function conditionFor(scope: CountScope, entry: CountableTable): RawBuilder<unknown> | null {
  switch (entry.reach) {
    case "person_id":
      return personCondition(scope.personId, entry.table);
    case "pair_person":
      return sql`creator_person_id = ${scope.personId}::uuid OR joiner_person_id = ${scope.personId}::uuid`;
    case "answer_person":
      return sql`asker_person_id = ${scope.personId}::uuid OR subject_person_id = ${scope.personId}::uuid`;
    case "meeting_id":
      return meetingCondition(scope.meetingIds, entry.table);
    case "comic_id":
      return comicCondition(scope.meetingIds);
    case "ledger_nulled":
      return ledgerCondition(scope);
  }
}

// The rows that carry this person's person_id; the people table is counted by its own id.
function personCondition(personId: string, table: string): RawBuilder<unknown> {
  return table === "people" ? sql`id = ${personId}::uuid` : sql`person_id = ${personId}::uuid`;
}

// The rows of the person's meetings, by meeting_id (meetings by id); null when the person has no meetings.
function meetingCondition(meetingIds: string[], table: string): RawBuilder<unknown> | null {
  if (meetingIds.length === 0) return null;
  return table === "meetings" ? sql`id = ANY(${meetingIds}::uuid[])` : sql`meeting_id = ANY(${meetingIds}::uuid[])`;
}

// The comic panels of the person's meetings, through their comics; null when the person has no meetings.
function comicCondition(meetingIds: string[]): RawBuilder<unknown> | null {
  if (meetingIds.length === 0) return null;
  return sql`comic_id IN (SELECT id FROM comics WHERE meeting_id = ANY(${meetingIds}::uuid[]))`;
}

// The ledger rows that name the person or one of the person's meetings; the rows stay, the ids go null (D69).
function ledgerCondition(scope: CountScope): RawBuilder<unknown> {
  const own = sql`person_id = ${scope.personId}::uuid`;
  if (scope.meetingIds.length === 0) return own;
  return sql`${own} OR meeting_id = ANY(${scope.meetingIds}::uuid[])`;
}
