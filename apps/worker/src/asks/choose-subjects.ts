// Writes an ask's answer rows once: up to 20 listed personas whose public items match a help
// search, the one friend of a friend ask, or the person of a self ask. Subjects are read in their
// own context and only read; the rows are written in the asker's context.
import { sql, type Kysely } from "kysely";
import { HELP_SHORTLIST_MAX } from "@meet-first/contracts";
import { withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import type { JobContext } from "../job-context.js";
import { shortlistWords } from "./ask-requests.js";
import {
  countAnswers,
  insertAnswers,
  lockAsk,
  readDisplayName,
  type AskRow,
  type NewAnswer,
} from "./ask-store.js";

// What choosing the subjects ended with: answer rows exist, nobody can answer this help search, or
// the friend ask cannot be answered.
export type SubjectsOutcome = "rows" | "none" | "failed";
// One row of directory_shortlist (migration 0006; its fourth argument is p_romance_only).
type ShortlistRow = {
  listing_id: string;
  person_id: string;
  card_id: string;
  display_name: string;
  line: string;
  match_rank: number;
};

// Makes sure the ask has its answer rows: rows an earlier run wrote are kept, and otherwise the
// subjects are chosen and written once.
export async function chooseSubjects(context: JobContext, ask: AskRow): Promise<SubjectsOutcome> {
  const existing = await withPerson(context.db, ask.personId, (trx) => countAnswers(trx, ask.id));
  if (existing > 0) return "rows";
  const subjects = await subjectsOf(context.db, ask);
  if (subjects === "failed") return "failed";
  if (subjects.length === 0) return "none";
  const isWritten = await withPerson(context.db, ask.personId, (trx) =>
    writeSubjects(trx, ask, subjects),
  );
  return isWritten ? "rows" : "none";
}

// Writes the rows under a lock on the ask, unless another run wrote them first; false when the
// asker's own row is gone.
async function writeSubjects(
  trx: DatabaseTransaction,
  ask: AskRow,
  subjects: readonly NewAnswer[],
): Promise<boolean> {
  await lockAsk(trx, ask.id);
  if ((await countAnswers(trx, ask.id)) > 0) return true;
  const askerName = await readDisplayName(trx, ask.personId);
  if (askerName === null) return false;
  await insertAnswers(trx, { ask, askerName, subjects });
  return true;
}

// The listed personas of a help search, in shortlist order. The shortlist runs on the worker
// connection with no person context, because only the worker may run directory_shortlist and it
// reads every listing (migration 0006). A romance ask reaches only listings open to dating
// questions.
async function helpSubjects(db: Kysely<Database>, ask: AskRow): Promise<NewAnswer[]> {
  const words = shortlistWords(ask.text);
  if (words.length === 0) return [];
  const isRomanceOnly = ask.questionKind === "romance";
  const listed =
    await sql<ShortlistRow>`SELECT listing_id, person_id, card_id, display_name, line, match_rank FROM directory_shortlist(${words}::text[], ${ask.personId}::uuid, ${HELP_SHORTLIST_MAX}::int, ${isRomanceOnly}::boolean)`.execute(
      db,
    );
  const subjects: NewAnswer[] = [];
  for (const row of listed.rows) {
    const subject = await readListedSubject(db, row);
    if (subject !== null) subjects.push(subject);
  }
  return subjects;
}

// One shortlisted persona, read in its owner's context: the display name and the listing's line.
// Null when the person or the listing is gone, or the listing now names another card, so the
// shortlist's match no longer holds.
async function readListedSubject(
  db: Kysely<Database>,
  row: ShortlistRow,
): Promise<NewAnswer | null> {
  return withPerson(db, row.person_id, async (trx) => {
    const name = await readDisplayName(trx, row.person_id);
    const listing = await trx
      .selectFrom("directory_listings")
      .select(["line", "card_id"])
      .where("id", "=", row.listing_id)
      .executeTakeFirst();
    if (name === null || listing === undefined || listing.card_id !== row.card_id) return null;
    return {
      subjectPersonId: row.person_id,
      subjectCardId: row.card_id,
      listingId: row.listing_id,
      subjectDisplayName: name,
      subjectLine: listing.line,
      shortlistRank: row.match_rank,
    };
  });
}

// The subjects of an ask by its mode: the shortlist of a help search, the friend of a friend ask,
// or the person of a self ask.
function subjectsOf(db: Kysely<Database>, ask: AskRow): Promise<NewAnswer[] | "failed"> {
  if (ask.mode === "help") return helpSubjects(db, ask);
  if (ask.mode === "self") return selfSubject(db, ask);
  return friendSubject(db, ask);
}

// The person of a self ask, read in their own context: their display name and most recently
// approved card, with or without its friends switch, since they are asking about themself; no card
// when they have none, and the answer then rests on their summary alone. "failed" when the person
// is gone.
async function selfSubject(db: Kysely<Database>, ask: AskRow): Promise<NewAnswer[] | "failed"> {
  return withPerson(db, ask.personId, async (trx) => {
    const displayName = await readDisplayName(trx, ask.personId);
    if (displayName === null) return "failed";
    const card = await trx
      .selectFrom("cards")
      .select("id")
      .where("person_id", "=", ask.personId)
      .where("state", "=", "approved")
      .where("approved_at", "is not", null)
      .orderBy("approved_at", "desc")
      .orderBy("id")
      .limit(1)
      .executeTakeFirst();
    return [
      {
        subjectPersonId: ask.personId,
        subjectCardId: card?.id ?? null,
        listingId: null,
        subjectDisplayName: displayName,
        subjectLine: null,
        shortlistRank: 1,
      },
    ];
  });
}

// The friend of a friend ask: the other member of the ask's invite pair, read in the asker's
// context, with that friend's most recently approved card whose friends switch is on. "failed" when
// the pair is missing, not joined or made by the directory, or no such card exists.
async function friendSubject(db: Kysely<Database>, ask: AskRow): Promise<NewAnswer[] | "failed"> {
  const pairId = ask.pairId;
  if (pairId === null) return "failed";
  const pair = await withPerson(db, ask.personId, (trx) =>
    trx
      .selectFrom("pairs")
      .select(["creator_person_id", "joiner_person_id", "joined_at", "via_directory"])
      .where("id", "=", pairId)
      .executeTakeFirst(),
  );
  if (
    pair === undefined ||
    pair.joiner_person_id === null ||
    pair.joined_at === null ||
    pair.via_directory
  )
    return "failed";
  const friendId =
    pair.creator_person_id === ask.personId ? pair.joiner_person_id : pair.creator_person_id;
  const friend = await withPerson(db, friendId, (trx) => readFriendCard(trx, friendId));
  if (friend === null) return "failed";
  return [
    {
      subjectPersonId: friendId,
      subjectCardId: friend.cardId,
      listingId: null,
      subjectDisplayName: friend.displayName,
      subjectLine: null,
      shortlistRank: 1,
    },
  ];
}

// The friend's display name and most recently approved card with friends_can_ask on, in the
// friend's own context. A friend with no approved card at all is answered from their summary when
// it is ready with its friends switch on, so the card is null. Null when the name is missing, when
// every approved card has the switch off, or when there is no card and no such summary.
async function readFriendCard(
  trx: DatabaseTransaction,
  friendId: string,
): Promise<{ cardId: string | null; displayName: string } | null> {
  const displayName = await readDisplayName(trx, friendId);
  if (displayName === null) return null;
  const card = await trx
    .selectFrom("cards")
    .select("id")
    .where("person_id", "=", friendId)
    .where("state", "=", "approved")
    .where("friends_can_ask", "=", true)
    .where("approved_at", "is not", null)
    .orderBy("approved_at", "desc")
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
  if (card !== undefined) return { cardId: card.id, displayName };
  const anyCard = await trx
    .selectFrom("cards")
    .select("id")
    .where("person_id", "=", friendId)
    .where("state", "=", "approved")
    .executeTakeFirst();
  if (anyCard !== undefined) return null;
  const summary = await trx
    .selectFrom("person_summaries")
    .select("friends_can_ask")
    .where("person_id", "=", friendId)
    .where("state", "=", "ready")
    .executeTakeFirst();
  return summary?.friends_can_ask === true ? { cardId: null, displayName } : null;
}
