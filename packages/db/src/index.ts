// The client, the pool sizes and the reader for numbers Postgres returns as text (D56).
export { makeDatabase, numberFromPostgres, POOL_SIZE } from "./client.js";
// The two transaction wrappers and the transaction type they hand to callers (D55).
export { withPerson, withMeeting, type DatabaseTransaction } from "./transaction.js";
// The database types: one interface per table and view of migrations 0001 and 0002, and the whole database.
export type {
  Database,
  PeopleTable,
  SessionsTable,
  TransferLinksTable,
  SourcesTable,
  TurnsTable,
  RedactionsTable,
  CardsTable,
  CardItemsTable,
  QuizBankTable,
  QuizzesTable,
  QuizItemsTable,
  PairsTable,
  MeetingsTable,
  MeetingMembersTable,
  MeetingStepsTable,
  MeetingEventsTable,
  ClaimsTable,
  BriefsTable,
  ComicsTable,
  ComicPanelsTable,
  SharePagesTable,
  LedgerTable,
  DeletionsTable,
  ServiceHeartbeatsTable,
  SchemaMigrationsTable,
  NamesPassesTable,
  SourceNamesTable,
  RecallCorpusView,
} from "./types.js";
// The schema version and the boot check the worker runs (D71).
export { SCHEMA_VERSION, assertSchemaVersion, readSchemaVersion } from "./migrate.js";
// Reading a refusal off a Postgres error (docs/contracts.md section 4).
export { parseDatabaseError, TRIGGER_CODES, type DatabaseRefusal, type TriggerCode } from "./database-errors.js";
// The recall lookup (D38).
export { queryWords, searchRecallCorpus } from "./recall-search.js";
// The event log seq and the event append (invariant 11).
export { nextEventSeq, appendMeetingEvent } from "./event-seq.js";
// Counts, table by table, the rows that still point at one person (D69, invariant 16). The golden path reads it after a deletion.
export { countRowsForPerson } from "./count-person.js";
// The sample people's faces and post photos, as keys the web build maps to its images (3 Nov 2026).
export { sampleFaceKey, samplePostPhoto } from "./samples/sample-photos.js";
