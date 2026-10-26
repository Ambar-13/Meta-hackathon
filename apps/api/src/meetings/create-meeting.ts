import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { ContractError, CURATED_QUESTIONS, HTTP, MeetingCreate, MeetingCreateResponse, MEETINGS_PER_PERSON_PER_DAY, routes, Uuid } from "@meet-first/contracts";
import { parseDatabaseError, withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The refusals meeting_create raises by trigger code, each with the sentence the screen shows (Wave 0 section 4.5.4).
export const MEETING_CREATE_REFUSALS: Readonly<Record<"pair_not_joined" | "card_not_approved" | "other_card_missing", string>> = {
  pair_not_joined: "The other person has not joined this pair yet. Send them the invite link again.",
  card_not_approved: "Approve your card before you create a meeting.",
  other_card_missing: "The other person has no approved card yet. Ask them to approve theirs first.",
};
// The :id of POST /api/pairs/:id/meetings: a uuid, or the pair cannot exist.
const PairParams = z.object({ id: Uuid });

// The question a new meeting discusses: a curated one is checked at insert, free text waits for check_question (R10.5).
export function questionFromBody(body: MeetingCreate): { questionId: number | null; text: string; isChecked: boolean } {
  if ("questionId" in body) {
    const row = CURATED_QUESTIONS.find((candidate) => candidate.id === body.questionId);
    if (row === undefined) throw makePayloadInvalidError();
    return { questionId: body.questionId, text: row.text, isChecked: true };
  }
  return { questionId: null, text: body.freeText, isChecked: false };
}

// Midnight UTC of the given time, where the per-person meeting count starts again (D60) [confirm] (the same zone as the dollar caps).
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Refuses a sixth meeting membership in one UTC day for this person (D60: 5 meetings per day).
export async function assertUnderDailyMeetingCap(trx: Transaction<Database>, personId: string, now: Date): Promise<void> {
  // The person's own row is locked first, so meeting requests sent at once take turns and the count cannot be passed.
  await trx.selectFrom("people").select("id").where("id", "=", personId).forUpdate().execute();
  const row = await trx.selectFrom("meeting_members").select((eb) => eb.fn.countAll<string>().as("count"))
    .where("person_id", "=", personId).where("created_at", ">=", startOfUtcDay(now)).executeTakeFirstOrThrow();
  if (Number(row.count) >= MEETINGS_PER_PERSON_PER_DAY) {
    throw new ContractError("meeting_daily_cap", "You have been in 5 meetings today. Try again tomorrow.", HTTP.tooMany);
  }
}

// Registers POST /api/pairs/:id/meetings: 201 {meetingId}; 400, 404, 409 for the three refusals, 429 meeting_daily_cap.
export function registerCreateMeeting(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.meetings.createMeeting.path, async (request, reply) => {
    const personId = requirePerson(request);
    const pair = PairParams.safeParse(request.params);
    if (!pair.success) throw makeNotFoundError();
    const body = MeetingCreate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const question = questionFromBody(body.data);
    const meetingId = await withPerson(deps.db, personId, async (trx) => {
      await assertUnderDailyMeetingCap(trx, personId, deps.now());
      return createMeetingRow(trx, { pairId: pair.data.id, personId, cardId: body.data.cardId, question });
    });
    await deps.enqueue("check_question", { meetingId });
    return reply.code(201).send(MeetingCreateResponse.parse({ meetingId }));
  });
}

// Calls meeting_create and turns its refusals into 409 errors with the sentence the screen shows.
async function createMeetingRow(trx: Transaction<Database>, input: { pairId: string; personId: string; cardId: string; question: { questionId: number | null; text: string; isChecked: boolean } }): Promise<string> {
  const { question } = input;
  let meetingId: string | undefined;
  try {
    const result = await sql<{ meeting_id: string }>`SELECT meeting_create(${input.pairId}, ${input.personId}, ${input.cardId}, ${question.questionId}, ${question.text}, ${question.isChecked}) AS meeting_id`.execute(trx);
    meetingId = result.rows[0]?.meeting_id;
  } catch (error) {
    const refusal = parseDatabaseError(error);
    if (refusal !== null && Object.hasOwn(MEETING_CREATE_REFUSALS, refusal.code)) {
      throw new ContractError(refusal.code, MEETING_CREATE_REFUSALS[refusal.code as keyof typeof MEETING_CREATE_REFUSALS], HTTP.conflict);
    }
    throw error;
  }
  if (meetingId === undefined) throw new ContractError("meeting_create_failed", "The meeting could not be created. Try again.", HTTP.internal);
  return meetingId;
}
