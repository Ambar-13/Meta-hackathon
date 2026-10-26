// Every database read the golden path makes. Each runs inside withPerson or withMeeting, so row security applies, and reads only what the routes cannot show.
import { countRowsForPerson, makeDatabase, numberFromPostgres, POOL_SIZE, withMeeting, withPerson } from "@meet-first/db";
import { ExitError } from "./report.js";

// The database handle the reads take. The worker role is the one that may run both contexts.
export type GoldenDatabase = ReturnType<typeof makeDatabase>;
// A Postgres number that may be missing (a max over no rows), read as 0 when it is missing.
function numberOrZero(value: unknown): number {
  return value === null || value === undefined ? 0 : numberFromPostgres(value);
}

// The text of a redaction placeholder, as the scrubber writes it. Its count in a turn is the placeholder count (D14).
const REDACTED_OPEN = "[redacted:";

// Opens the worker connection that every read uses.
export function openWorkerDatabase(url: string): GoldenDatabase {
  return makeDatabase(url, POOL_SIZE.worker);
}

// Runs SELECT 1, so a wrong connection string stops the run before any step.
export async function checkDatabase(db: GoldenDatabase): Promise<void> {
  try {
    await db.selectNoFrom((eb) => [eb.val(1).as("one")]).execute();
  } catch {
    throw new ExitError(2, "golden_path_database_unreachable: check DATABASE_URL_WORKER.");
  }
}

// The count of this person's sessions that are not revoked (A5, invariant 20).
export async function countSessions(db: GoldenDatabase, personId: string): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx.selectFrom("sessions").select((eb) => eb.fn.countAll().as("count")).where("person_id", "=", personId).where("revoked_at", "is", null).executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// The source row fields the steps check: its kind, its turn count, and when its names pass, its review and its freeze happened.
export async function readSource(db: GoldenDatabase, personId: string, sourceId: string) {
  return withPerson(db, personId, (trx) =>
    trx.selectFrom("sources").select(["kind", "turn_count", "frozen_at", "names_reviewed_at", "attested_at"]).where("id", "=", sourceId).executeTakeFirstOrThrow(),
  );
}

// The number of redaction rows a source has (R2.5).
export async function countRedactions(db: GoldenDatabase, personId: string, sourceId: string): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx.selectFrom("redactions").select((eb) => eb.fn.countAll().as("count")).where("source_id", "=", sourceId).executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// How many turns of a source contain the needle text (D15, D17: a replaced name or email must not remain).
export async function countTurnsContaining(db: GoldenDatabase, personId: string, scope: { sourceId: string; needle: string }): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx
      .selectFrom("turns")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("source_id", "=", scope.sourceId)
      .where((eb) => eb(eb.fn("strpos", ["text", eb.val(scope.needle)]), ">", 0))
      .executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// The query that counts placeholders in a source's turns: each turn's length minus its length without the marker, over the marker's length, summed (R2.5, D14).
export function placeholderCountQuery(db: GoldenDatabase, sourceId: string) {
  return db
    .selectFrom("turns")
    .select((eb) =>
      eb.fn
        .coalesce(
          eb.fn.sum(
            eb(
              eb.parens(eb(eb.fn("length", ["text"]), "-", eb.fn("length", [eb.fn("replace", ["text", eb.val(REDACTED_OPEN), eb.val("")])]))),
              "/",
              eb.fn("length", [eb.val(REDACTED_OPEN)]),
            ),
          ),
          eb.lit(0),
        )
        .as("count"),
    )
    .where("source_id", "=", sourceId);
}

// How many redaction placeholders a source's turns hold, counted in the database.
export async function countPlaceholders(db: GoldenDatabase, personId: string, sourceId: string): Promise<number> {
  return withPerson(db, personId, async (trx) => numberFromPostgres((await placeholderCountQuery(trx, sourceId).executeTakeFirst())?.count));
}

// The card fields the steps check: its state, whether it is thin, its recall switch, and its item totals.
export async function readCard(db: GoldenDatabase, personId: string, cardId: string) {
  return withPerson(db, personId, (trx) =>
    trx.selectFrom("cards").select(["state", "thin", "recall_allowed", "items_total", "items_verified"]).where("id", "=", cardId).executeTakeFirstOrThrow(),
  );
}

// How many items of a card quote a turn outside its own source (invariant 5, R6.4). It must be zero.
export async function countItemsOutsideSource(db: GoldenDatabase, personId: string, scope: { cardId: string; sourceId: string }): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx
      .selectFrom("card_items")
      .innerJoin("turns", "turns.id", "card_items.turn_id")
      .select((eb) => eb.fn.countAll().as("count"))
      .where("card_items.card_id", "=", scope.cardId)
      .where("turns.source_id", "<>", scope.sourceId)
      .executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// How many items of a card the person approved (R7.1).
export async function countApprovedItems(db: GoldenDatabase, personId: string, cardId: string): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx.selectFrom("card_items").select((eb) => eb.fn.countAll().as("count")).where("card_id", "=", cardId).where("approved", "=", true).executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// How many rows of the recall corpus come from a card. Zero when the recall switch is off (invariant 16, R7.1).
export async function countRecallCorpus(db: GoldenDatabase, personId: string, cardId: string): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx.selectFrom("recall_corpus").select((eb) => eb.fn.countAll().as("count")).where("card_id", "=", cardId).executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// The quiz fields the steps check: its state, its matched count, its reliability flag, and how many judge runs it used.
export async function readQuiz(db: GoldenDatabase, personId: string, quizId: string) {
  return withPerson(db, personId, (trx) =>
    trx.selectFrom("quizzes").select(["state", "matched", "reliable", "judge_runs"]).where("id", "=", quizId).executeTakeFirstOrThrow(),
  );
}

// The meeting fields the steps check: its state, phase, times, end reason and the question check time.
export async function readMeeting(db: GoldenDatabase, meetingId: string) {
  return withMeeting(db, meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select(["state", "phase", "started_at", "ends_at", "ended_at", "end_reason", "question_checked_at"])
      .where("id", "=", meetingId)
      .executeTakeFirstOrThrow(),
  );
}

// The reason the question check refused a question, or null when it allowed it (R10.5).
export async function readQuestionRejection(db: GoldenDatabase, meetingId: string): Promise<string | null> {
  return withMeeting(db, meetingId, async (trx) => {
    const row = await trx.selectFrom("meetings").select("question_rejected_reason").where("id", "=", meetingId).executeTakeFirstOrThrow();
    return row.question_rejected_reason;
  });
}

// How many steps a meeting has, and the largest step seq (D34: one step at the start).
export async function countSteps(db: GoldenDatabase, meetingId: string): Promise<{ count: number; max: number }> {
  return withMeeting(db, meetingId, async (trx) => {
    const row = await trx.selectFrom("meeting_steps").select((eb) => [eb.fn.countAll().as("count"), eb.fn.max("step_seq").as("max")]).where("meeting_id", "=", meetingId).executeTakeFirstOrThrow();
    return { count: numberFromPostgres(row.count), max: numberOrZero(row.max) };
  });
}

// The two members of a meeting: their side, their go-ahead and last-seen times, whether a frozen prefix is stored (D41), and whether
// the member speaks from public items only, as a listed persona met through the directory does (design section 2).
export async function readMembers(db: GoldenDatabase, meetingId: string) {
  return withMeeting(db, meetingId, async (trx) => {
    const rows = await trx.selectFrom("meeting_members").select(["side", "ready_at", "last_seen_at", "frozen_prefix_tokens", "public_only"]).where("meeting_id", "=", meetingId).orderBy("side").execute();
    return rows.map((row) => ({ side: row.side, readyAt: row.ready_at, lastSeenAt: row.last_seen_at, hasPrefix: row.frozen_prefix_tokens !== null, publicOnly: row.public_only }));
  });
}

// The turn ids that the stored claims of one ask's answers quote, read as the asker. A claim whose quote was not found has none.
export async function readAnswerTurnIds(db: GoldenDatabase, askerId: string, askId: string): Promise<string[]> {
  return withPerson(db, askerId, async (trx) => {
    const rows = await trx.selectFrom("persona_answers").select("claims").where("ask_id", "=", askId).execute();
    return rows.flatMap((row) => (Array.isArray(row.claims) ? row.claims : [])).flatMap((claim) => {
      const turnId = typeof claim === "object" && claim !== null && "turnId" in claim ? claim.turnId : null;
      return typeof turnId === "string" ? [turnId] : [];
    });
  });
}

// How many committed events a meeting has, and the largest seq.
export async function countEvents(db: GoldenDatabase, meetingId: string): Promise<{ count: number; max: number }> {
  return withMeeting(db, meetingId, async (trx) => {
    const row = await trx.selectFrom("meeting_events").select((eb) => [eb.fn.countAll().as("count"), eb.fn.max("seq").as("max")]).where("meeting_id", "=", meetingId).executeTakeFirstOrThrow();
    return { count: numberFromPostgres(row.count), max: numberOrZero(row.max) };
  });
}

// How many committed events of one type a meeting has (for example one meeting.ended).
export async function countEventsByType(db: GoldenDatabase, meetingId: string, type: string): Promise<number> {
  return withMeeting(db, meetingId, async (trx) => {
    const row = await trx.selectFrom("meeting_events").select((eb) => eb.fn.countAll().as("count")).where("meeting_id", "=", meetingId).where("type", "=", type).executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// The claim counts of a meeting: every claim, how many were verified, and how many were flagged (invariant 6).
export async function readClaimsSummary(db: GoldenDatabase, meetingId: string): Promise<{ total: number; verified: number; flagged: number }> {
  return withMeeting(db, meetingId, async (trx) => {
    const total = numberFromPostgres((await trx.selectFrom("claims").select((eb) => eb.fn.countAll().as("count")).where("meeting_id", "=", meetingId).executeTakeFirst())?.count);
    const verified = numberFromPostgres((await trx.selectFrom("claims").select((eb) => eb.fn.countAll().as("count")).where("meeting_id", "=", meetingId).where("verified", "=", true).executeTakeFirst())?.count);
    const flagged = numberFromPostgres((await trx.selectFrom("claims").select((eb) => eb.fn.countAll().as("count")).where("meeting_id", "=", meetingId).where("flagged", "=", true).executeTakeFirst())?.count);
    return { total, verified, flagged };
  });
}

// The text of every flagged claim in a meeting. The share page must show none of them.
export async function readFlaggedClaimTexts(db: GoldenDatabase, meetingId: string): Promise<string[]> {
  return withMeeting(db, meetingId, async (trx) => {
    const rows = await trx.selectFrom("claims").select("text").where("meeting_id", "=", meetingId).where("flagged", "=", true).execute();
    return rows.map((row) => row.text);
  });
}

// The first agree line text of a brief, read from the stored JSON, or null when there is none.
function firstAgreeText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const [first] = value as unknown[];
  if (typeof first === "object" && first !== null && "text" in first && typeof first.text === "string") return first.text;
  return null;
}

// Each person's own brief row: who owns it, its support rate and reliability flag, and its first agree line (A1, R6.5).
export async function readBriefOwners(db: GoldenDatabase, meetingId: string) {
  return withMeeting(db, meetingId, async (trx) => {
    const rows = await trx.selectFrom("briefs").select(["person_id", "support_rate", "support_reliable", "agree"]).where("meeting_id", "=", meetingId).execute();
    return rows.map((row) => ({ personId: row.person_id, supportReliable: row.support_reliable, firstAgree: firstAgreeText(row.agree) }));
  });
}

// The comic row of a meeting, with the number of its panels, or undefined when none was asked for (R11.1).
export async function readComic(db: GoldenDatabase, meetingId: string): Promise<{ id: string; state: string; panels: number } | undefined> {
  return withMeeting(db, meetingId, async (trx) => {
    const comic = await trx.selectFrom("comics").select(["id", "state"]).where("meeting_id", "=", meetingId).executeTakeFirst();
    if (comic === undefined) return undefined;
    const panels = await trx.selectFrom("comic_panels").select((eb) => eb.fn.countAll().as("count")).where("comic_id", "=", comic.id).executeTakeFirst();
    return { id: comic.id, state: comic.state, panels: numberFromPostgres(panels?.count) };
  });
}

// The share page row of a meeting: each side's consent, whether it is published, when it was withdrawn, and its slug (D68).
export async function readSharePage(db: GoldenDatabase, meetingId: string) {
  return withMeeting(db, meetingId, (trx) =>
    trx.selectFrom("share_pages").select(["consent_a", "consent_b", "published", "revoked_at", "slug"]).where("meeting_id", "=", meetingId).executeTakeFirst(),
  );
}

// Whether a meeting is visible to one person: 1 when it is, 0 when the person was removed from it (R9.7).
export async function countMeetingAsMember(db: GoldenDatabase, personId: string, meetingId: string): Promise<number> {
  return withPerson(db, personId, async (trx) => {
    const row = await trx.selectFrom("meetings").select((eb) => eb.fn.countAll().as("count")).where("id", "=", meetingId).executeTakeFirst();
    return numberFromPostgres(row?.count);
  });
}

// Every table of a person and how many rows still point at them (D69, invariant 16). The list comes from the db package.
export async function countPerson(db: GoldenDatabase, personId: string): Promise<Record<string, number>> {
  return countRowsForPerson(db, personId);
}

// The distinct llm modes and call sites of the ledger, read from the meeting and both people's contexts and merged (D74, D69).
export async function readLedgerFacts(db: GoldenDatabase, meetingId: string, personIds: readonly [string, string]): Promise<{ modes: string[]; callSites: string[] }> {
  const parts: Array<{ modes: string[]; callSites: string[] }> = [];
  parts.push(await withMeeting(db, meetingId, distinctLedger));
  for (const personId of personIds) {
    parts.push(await withPerson(db, personId, distinctLedger));
  }
  const modes = new Set(parts.flatMap((part) => part.modes));
  const callSites = new Set(parts.flatMap((part) => part.callSites));
  return { modes: [...modes].sort(), callSites: [...callSites].sort() };
}

// The distinct modes and call sites in one context.
async function distinctLedger(trx: GoldenDatabase): Promise<{ modes: string[]; callSites: string[] }> {
  const modeRows = await trx.selectFrom("ledger").select("llm_mode").distinct().execute();
  const siteRows = await trx.selectFrom("ledger").select("call_site").distinct().execute();
  return { modes: modeRows.map((row) => row.llm_mode), callSites: siteRows.map((row) => row.call_site) };
}
