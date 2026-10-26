import { randomBytes } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { CURATED_QUESTIONS, ContractError, PAIR_LIFETIME_HOURS, PAIR_TOKEN_BYTES } from "@meet-first/contracts";
import { withPerson } from "../transaction.js";
import type { Database } from "../types.js";
import { createApprovedCard, createFrozenSource, createTestPerson, sha256Text } from "./seed-people.js";

// The three turns side a uploads in every seeded meeting; each is long enough to be quoted (D25).
export const SEED_TURNS_A = [
  "I always write the plan down before a big meeting so nobody guesses.",
  "Deadlines matter to me; when one slips I tell the team the same day.",
  "On weekends I hike with my sister and leave my phone at home.",
] as const;

// The three turns side b uploads in every seeded meeting; each is long enough to be quoted (D25).
export const SEED_TURNS_B = [
  "Deadlines are guides for me; I care more about the work being right.",
  "I like to think out loud with the team before I decide anything.",
  "When plans change late I need a day to adjust and I say so.",
] as const;

// One side of a seeded meeting, with everything a test may need to act as it.
export type SeededSide = { personId: string; sessionToken: string; recoveryCode: string; sourceId: string; turnIds: string[]; cardId: string };

// A seeded meeting with both sides in full and the invite token that joined them.
export type SeededMeeting = { meetingId: string; pairId: string; inviteToken: string; a: SeededSide; b: SeededSide };

// Creates two people with frozen sources and approved cards (recall on for a, off for b), a joined pair and a ready meeting on a curated question.
export async function createPairedMeetingWithTurns(db: Kysely<Database>, options: { questionId?: number } = {}): Promise<SeededMeeting> {
  const a = await createTestPerson(db, "Test A");
  const b = await createTestPerson(db, "Test B");
  const sourceA = await createFrozenSource(db, a.personId, [...SEED_TURNS_A]);
  const sourceB = await createFrozenSource(db, b.personId, [...SEED_TURNS_B]);
  const cardA = await createApprovedCard(db, sourceA.sourceId, { recallAllowed: true });
  const cardB = await createApprovedCard(db, sourceB.sourceId, { recallAllowed: false });
  const inviteToken = randomBytes(PAIR_TOKEN_BYTES).toString("hex");
  const pair = await withPerson(db, a.personId, (trx) => trx.insertInto("pairs").values({ creator_person_id: a.personId, token_hash: sha256Text(inviteToken), expires_at: new Date(Date.now() + PAIR_LIFETIME_HOURS * 3_600_000) }).returning("id").executeTakeFirstOrThrow());
  const joined = await sql<{ pair_id: string | null }>`SELECT pairs_join(${sha256Text(inviteToken)}, ${b.personId}::uuid) AS pair_id`.execute(db);
  if (joined.rows[0]?.pair_id !== pair.id) throw new ContractError("seed_pair_join_failed", "pairs_join did not join the seeded pair. Check that migration 0001 ran.", 500);
  const questionId = options.questionId ?? 3;
  const question = CURATED_QUESTIONS.find((row) => row.id === questionId);
  if (question === undefined) throw new ContractError("seed_question_unknown", "questionId must be one of the 12 curated question ids.", 500);
  const created = await sql<{ meeting_id: string | null }>`SELECT meeting_create(${pair.id}::uuid, ${a.personId}::uuid, ${cardA.cardId}::uuid, ${questionId}::int, ${question.text}, true) AS meeting_id`.execute(db);
  const meetingId = created.rows[0]?.meeting_id;
  if (meetingId === null || meetingId === undefined) throw new Error("meeting_create returned no id. Check that migration 0001 ran.");
  // The route writes a curated question's kind after meeting_create; the seed does the same, so seeded meetings match real ones.
  await withPerson(db, a.personId, (trx) => trx.updateTable("meetings").set({ question_kind: question.kind }).where("id", "=", meetingId).execute());
  return {
    meetingId, pairId: pair.id, inviteToken,
    a: { personId: a.personId, sessionToken: a.sessionToken, recoveryCode: a.recoveryCode, sourceId: sourceA.sourceId, turnIds: sourceA.turnIds, cardId: cardA.cardId },
    b: { personId: b.personId, sessionToken: b.sessionToken, recoveryCode: b.recoveryCode, sourceId: sourceB.sourceId, turnIds: sourceB.turnIds, cardId: cardB.cardId },
  };
}

// The same meeting in the shape docs/contracts.md section 4 freezes.
export async function createPairedMeeting(db: Kysely<Database>, options: { questionId?: number } = {}): Promise<{ meetingId: string; pairId: string; a: { personId: string; cardId: string; sessionToken: string }; b: { personId: string; cardId: string; sessionToken: string } }> {
  const seeded = await createPairedMeetingWithTurns(db, options);
  return {
    meetingId: seeded.meetingId, pairId: seeded.pairId,
    a: { personId: seeded.a.personId, cardId: seeded.a.cardId, sessionToken: seeded.a.sessionToken },
    b: { personId: seeded.b.personId, cardId: seeded.b.cardId, sessionToken: seeded.b.sessionToken },
  };
}
