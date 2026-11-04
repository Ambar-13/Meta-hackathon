// The people, listings, pairs, asks and quiz rows the ask tests seed, and the reads their checks
// use. Every write runs as the row's owner, as the app's routes would.
import { randomBytes } from "node:crypto";
import { sql, type Kysely, type Selectable } from "kysely";
import {
  PAIR_LIFETIME_HOURS,
  PAIR_TOKEN_BYTES,
  QUIZ_BANK,
  sampleQuiz,
  type SummaryPointView,
} from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import {
  createApprovedCard,
  createFrozenSource,
  createTestPerson,
  sha256Text,
} from "@meet-first/db/testing";

// One seeded person: their ids, display name, approved card (3 items quoting turns 0, 1 and 2) and
// turn ids in turn order.
export type AskPerson = {
  personId: string;
  displayName: string;
  cardId: string;
  turnIds: string[];
};

// The turns of the test people. Each is long enough to quote, and no line shares 20 characters with
// a prompt. Omar's turns are Cyrillic and Rosa's, Tom's and Iris's are Greek, so no English ask
// matches them.
export const ASK_TURNS = {
  ana: [
    "I write my own training loops for small language models every weekend.",
    "Code without tests makes me nervous, so I add them before refactoring.",
    "I swim before work three mornings a week to clear my head.",
  ],
  kai: [
    "Every model I train gets a fixed validation split before the first epoch starts.",
    "I keep a lab notebook with the learning rate and batch size of each run.",
    "On Fridays I bake sourdough with my neighbours and nobody talks about work.",
    "Moving a demo date late makes me rework my week, so I ask for two days notice.",
  ],
  lena: [
    "I review pull requests the same morning they arrive, before standup.",
    "Plotting gradient norms per layer is the first thing I do when training stalls.",
    "I sing in a choir on Tuesday evenings and keep that night free.",
    "I prefer written agendas to surprise calls about plans.",
  ],
  omar: [
    "Я люблю работать с конвейерами данных и ловить ошибки схемы рано.",
    "Панели должны показывать медиану и худший случай, а не только среднее.",
    "По воскресеньям я работаю в саду с самого утра.",
  ],
  noor: [
    "I tune learning rate warmup schedules for long pretraining runs.",
    "Checkpoint averaging saved one of my projects last spring.",
    "I volunteer at a bike repair cafe twice a month.",
  ],
  ivo: [
    "Warmup schedules plus checkpoint averaging are favourite tricks of mine.",
    "Evenings are for chess puzzles with a pot of green tea.",
    "I keep my desk empty except for one notebook.",
  ],
  rosa: [
    "Μου αρέσει να χορεύω σάλσα κάθε Πέμπτη βράδυ με φίλους.",
    "Μαγειρεύω για τους φίλους μου κάθε Κυριακή μεσημέρι.",
    "Διαβάζω ποίηση πριν κοιμηθώ σχεδόν κάθε βράδυ.",
  ],
  tom: [
    "Ο χορός σάλσα με βοηθά να ξεχνώ τη δουλειά της εβδομάδας.",
    "Τρέχω στην παραλία νωρίς το πρωί όταν έχει ήλιο.",
    "Παίζω κιθάρα σε ένα μικρό συγκρότημα με συναδέλφους.",
  ],
  iris: [
    "Παίζω βιολί σε ορχήστρα δωματίου κάθε Σάββατο απόγευμα.",
    "Το καλοκαίρι κολυμπώ στη θάλασσα πριν τη δουλειά.",
    "Μαθαίνω ιαπωνικά με μια εφαρμογή κάθε πρωί.",
  ],
} as const;
// The listing line of each test person who joins the directory.
export const ASK_LINES = {
  ana: "I build training loops for small models.",
  kai: "Vision models and careful experiments.",
  lena: "Code review, and debugging stalled training.",
  omar: "Конвейеры данных и схемы.",
  noor: "Warmup schedules for long pretraining runs.",
  ivo: "Checkpoint averaging fan.",
  rosa: "Χορεύω σάλσα και μαγειρεύω.",
  tom: "Σάλσα και κιθάρα.",
  iris: "Βιολί και μουσική δωματίου.",
} as const;

// Creates a person with a frozen source of these turns and an approved card of 3 verified items quoting turns 0, 1 and 2;
// the recall switch is off unless isRecallAllowed is true.
export async function createAskPerson(
  db: Kysely<Database>,
  person: { name: string; turns: readonly string[]; isRecallAllowed?: boolean },
): Promise<AskPerson> {
  const created = await createTestPerson(db, person.name);
  const source = await createFrozenSource(db, created.personId, [...person.turns]);
  const card = await createApprovedCard(db, source.sourceId, {
    recallAllowed: person.isRecallAllowed ?? false,
    items: 3,
  });
  return {
    personId: created.personId,
    displayName: person.name,
    cardId: card.cardId,
    turnIds: source.turnIds,
  };
}

// Marks these item positions of the person's card public, as the owner does on the card screen.
export async function markPublic(
  db: Kysely<Database>,
  person: AskPerson,
  positions: number[],
): Promise<void> {
  await withPerson(db, person.personId, (trx) =>
    trx
      .updateTable("card_items")
      .set({ is_public: true })
      .where("card_id", "=", person.cardId)
      .where("position", "in", positions)
      .execute(),
  );
}

// Takes back the owner's approval of one item that is not public.
export async function unapproveItem(
  db: Kysely<Database>,
  person: AskPerson,
  position: number,
): Promise<void> {
  await withPerson(db, person.personId, (trx) =>
    trx
      .updateTable("card_items")
      .set({ approved: false })
      .where("card_id", "=", person.cardId)
      .where("position", "=", position)
      .execute(),
  );
}

// Lists the person in the directory with this line and dating switch, off unless isOpenToRomance is
// true; returns the listing id.
export async function listInDirectory(
  db: Kysely<Database>,
  person: AskPerson,
  listing: { line: string; isOpenToRomance?: boolean },
): Promise<string> {
  const row = await withPerson(db, person.personId, (trx) =>
    trx
      .insertInto("directory_listings")
      .values({
        person_id: person.personId,
        card_id: person.cardId,
        line: listing.line,
        open_to_romance: listing.isOpenToRomance ?? false,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// Deletes the person's listing, as leaving the directory does.
export async function leaveDirectory(db: Kysely<Database>, person: AskPerson): Promise<void> {
  await withPerson(db, person.personId, (trx) =>
    trx.deleteFrom("directory_listings").where("person_id", "=", person.personId).execute(),
  );
}

// Sets the dating switch of the person's listing.
export async function setRomanceSwitch(
  db: Kysely<Database>,
  person: AskPerson,
  isOpen: boolean,
): Promise<void> {
  await withPerson(db, person.personId, (trx) =>
    trx
      .updateTable("directory_listings")
      .set({ open_to_romance: isOpen })
      .where("person_id", "=", person.personId)
      .execute(),
  );
}

// Turns the friends switch on for the person's card.
export async function allowFriendAsks(db: Kysely<Database>, person: AskPerson): Promise<void> {
  await withPerson(db, person.personId, (trx) =>
    trx
      .updateTable("cards")
      .set({ friends_can_ask: true })
      .where("id", "=", person.cardId)
      .execute(),
  );
}

// Joins two people by an invite pair, as the invite link does: the creator makes the pair, the
// joiner joins it with pairs_join. Returns the pair id.
export async function joinInvitePair(
  db: Kysely<Database>,
  creator: Pick<AskPerson, "personId">,
  joiner: Pick<AskPerson, "personId">,
): Promise<string> {
  const token = randomBytes(PAIR_TOKEN_BYTES).toString("hex");
  const pair = await withPerson(db, creator.personId, (trx) =>
    trx
      .insertInto("pairs")
      .values({
        creator_person_id: creator.personId,
        token_hash: sha256Text(token),
        expires_at: new Date(Date.now() + PAIR_LIFETIME_HOURS * 3_600_000),
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  await sql`SELECT pairs_join(${sha256Text(token)}, ${joiner.personId}::uuid)`.execute(db);
  return pair.id;
}

// Inserts a help search as its asker, as POST /api/asks does: mode help, state checking.
export async function insertHelpAsk(
  db: Kysely<Database>,
  asker: AskPerson,
  text: string,
): Promise<string> {
  const row = await withPerson(db, asker.personId, (trx) =>
    trx
      .insertInto("persona_asks")
      .values({ person_id: asker.personId, mode: "help", text })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// Inserts a friend ask as its asker, with the pair and the friend's name as the route copies them.
export async function insertReactAsk(
  db: Kysely<Database>,
  asker: AskPerson,
  ask: { pairId: string; text: string; aboutName: string },
): Promise<string> {
  const row = await withPerson(db, asker.personId, (trx) =>
    trx
      .insertInto("persona_asks")
      .values({
        person_id: asker.personId,
        mode: "react",
        pair_id: ask.pairId,
        text: ask.text,
        about_name: ask.aboutName,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// Writes a self ask of the person, with their own name as about_name, as POST /api/asks does.
export async function insertSelfAsk(
  db: Kysely<Database>,
  person: Pick<AskPerson, "personId" | "displayName">,
  text: string,
): Promise<string> {
  const row = await withPerson(db, person.personId, (trx) =>
    trx
      .insertInto("persona_asks")
      .values({ person_id: person.personId, mode: "self", text, about_name: person.displayName })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  return row.id;
}

// Seeds a judged, reliable quiz on the person's card whose first sampled question was missed, as
// the meeting test D31-T2 does, and returns that question's text, the one do-not-guess topic. It
// runs on the worker database, which writes quizzes.
export async function seedJudgedQuiz(
  workerDb: Kysely<Database>,
  person: AskPerson,
): Promise<string> {
  const ids = sampleQuiz(person.cardId);
  await withPerson(workerDb, person.personId, async (trx) => {
    const quiz = await trx
      .insertInto("quizzes")
      .values({
        card_id: person.cardId,
        person_id: person.personId,
        bank_version: 1,
        seed: person.cardId,
        state: "judged",
        matched: 9,
        reliable: true,
        judge_runs: 1,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("quiz_items")
      .values(
        ids.map((questionId, index) => ({
          quiz_id: quiz.id,
          person_id: person.personId,
          position: index + 1,
          bank_version: 1,
          question_id: questionId,
          persona_answer: "p",
          human_answer: "h",
          flipped: false,
          agree: index !== 0,
        })),
      )
      .execute();
  });
  return QUIZ_BANK[(ids[0] ?? 1) - 1]?.text ?? "";
}

// The ask row, read as its asker.
export async function readAskRow(
  db: Kysely<Database>,
  asker: AskPerson,
  askId: string,
): Promise<Selectable<Database["persona_asks"]>> {
  return withPerson(db, asker.personId, (trx) =>
    trx.selectFrom("persona_asks").selectAll().where("id", "=", askId).executeTakeFirstOrThrow(),
  );
}

// The ask's answer rows, read as the asker, by shortlist rank.
export async function readAnswerRows(
  db: Kysely<Database>,
  asker: Pick<AskPerson, "personId">,
  askId: string,
): Promise<Array<Selectable<Database["persona_answers"]>>> {
  return withPerson(db, asker.personId, (trx) =>
    trx
      .selectFrom("persona_answers")
      .selectAll()
      .where("ask_id", "=", askId)
      .orderBy("shortlist_rank")
      .execute(),
  );
}

// Stores a checked summary for the person, as the check_summary job leaves it, with friend asks on
// or off.
export async function seedReadySummary(
  db: Kysely<Database>,
  person: Pick<AskPerson, "personId">,
  summary: { points: readonly SummaryPointView[]; isFriendsOn: boolean },
): Promise<void> {
  await withPerson(db, person.personId, (trx) =>
    trx
      .insertInto("person_summaries")
      .values({
        person_id: person.personId,
        text: "Kind: view\nPoint: Seeded for a test.",
        points: JSON.stringify(summary.points),
        state: "ready",
        friends_can_ask: summary.isFriendsOn,
      })
      .onConflict((conflict) =>
        conflict.column("person_id").doUpdateSet({
          points: JSON.stringify(summary.points),
          state: "ready",
          friends_can_ask: summary.isFriendsOn,
        }),
      )
      .execute(),
  );
}
