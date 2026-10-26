// What exists: a finished help search shows up to three placed answers with a "Start a meeting" button (design section 7).
// The problem: a meeting with a stranger may start only from the asker's own finished results, only with a helper still listed,
// and within both daily caps. The step: one transaction reads the ask and the answer as the asker, refuses anything not meetable,
// takes the asker's meeting cap, and calls directory_meeting_create, which locks the listing, checks both cards and the listed
// person's cap, and writes the pair, the meeting and both members. check_question is enqueued after the commit and builds the two
// prompt prefixes. What it does not do: undo the meeting when the queue refuses check_question; create-meeting.ts does not either.
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { AnswerMeetingCreate, ContractError, DIRECTORY_MEETINGS_PER_LISTING_PER_DAY, HTTP, MeetingCreateResponse, routes, Uuid } from "@meet-first/contracts";
import { parseDatabaseError, withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { assertUnderDailyMeetingCap } from "../meetings/create-meeting.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { isMeetableAnswer } from "./ask-rows.js";
import type { AskDeps } from "./create-ask.js";

// The :id and :answerId of the meeting route; a value that is not a uuid is not_found.
const AnswerParams = z.object({ id: Uuid, answerId: Uuid });

// What the meeting takes from the ask and its answer: the ask's text as the question, and the helper's listing.
type MeetTarget = { askText: string; listingId: string };

// The refusal for every answer that cannot be met from these results (design section 6).
function makeHelperNotMeetableError(): ContractError {
  return new ContractError("helper_not_meetable", "This person can no longer be met from these results.", HTTP.conflict);
}

// Reads the caller's ask and the answer as the caller, and refuses unless the answer is meetable (design section 6).
async function readMeetTarget(trx: Transaction<Database>, input: { personId: string; askId: string; answerId: string }): Promise<MeetTarget> {
  const ask = await trx.selectFrom("persona_asks").select(["mode", "state", "text"]).where("id", "=", input.askId).where("person_id", "=", input.personId).executeTakeFirst();
  const answer = await trx.selectFrom("persona_answers").select(["state", "position", "listing_id"])
    .where("id", "=", input.answerId).where("ask_id", "=", input.askId).where("asker_person_id", "=", input.personId).executeTakeFirst();
  if (ask === undefined || answer === undefined || answer.listing_id === null || !isMeetableAnswer(ask, answer)) throw makeHelperNotMeetableError();
  return { askText: ask.text, listingId: answer.listing_id };
}

// Turns a refusal of directory_meeting_create into this route's error, or returns null for any other error, which goes on unchanged
// (design section 6). A listing that is gone, or a helper who is the caller, is helper_not_meetable [confirm]; a card that is not the
// caller's approved card and the listed person's daily cap keep the database's code and sentence [confirm].
function toMeetRefusal(error: unknown): ContractError | null {
  const refusal = parseDatabaseError(error);
  if (refusal === null) return null;
  if (refusal.code === "listing_not_found" || refusal.code === "directory_self") return makeHelperNotMeetableError();
  if (refusal.code === "card_not_approved") return new ContractError(refusal.code, refusal.message, HTTP.conflict);
  if (refusal.code === "directory_daily_cap") return new ContractError(refusal.code, refusal.message, HTTP.tooMany);
  return null;
}

// Starts the meeting with the ask's text as an already checked question of kind help (design sections 6 and 11).
async function createDirectoryMeeting(trx: Transaction<Database>, input: { listingId: string; personId: string; cardId: string; askText: string }): Promise<string> {
  let meetingId: string | null | undefined;
  try {
    // In words: meet the listing's person as side a with this card, on the ask's text, checked now, kind help, at most 10 a day for that person.
    const result = await sql<{ meeting_id: string | null }>`SELECT directory_meeting_create(${input.listingId}::uuid, ${input.personId}::uuid, ${input.cardId}::uuid, NULL::int, ${input.askText}::text, true, 'help'::text, ${DIRECTORY_MEETINGS_PER_LISTING_PER_DAY}::int) AS meeting_id`.execute(trx);
    meetingId = result.rows[0]?.meeting_id;
  } catch (error) {
    throw toMeetRefusal(error) ?? error;
  }
  if (meetingId === null || meetingId === undefined) throw new ContractError("meeting_create_failed", "The meeting could not be created. Try again.", HTTP.internal);
  return meetingId;
}

// Starts a full meeting with a helper from the caller's help results, then enqueues check_question after the commit.
async function meetHelper(deps: AskDeps, input: { personId: string; askId: string; answerId: string; cardId: string }): Promise<string> {
  const meetingId = await withPerson(deps.db, input.personId, async (trx) => {
    const target = await readMeetTarget(trx, input);
    await assertUnderDailyMeetingCap(trx, input.personId, deps.now());
    return createDirectoryMeeting(trx, { listingId: target.listingId, personId: input.personId, cardId: input.cardId, askText: target.askText });
  });
  await deps.enqueue("check_question", { meetingId });
  return meetingId;
}

// Registers POST /api/asks/:id/answers/:answerId/meeting: 201 {meetingId}; 400 payload_invalid; 404 not_found for a bad id; 409
// helper_not_meetable or card_not_approved; 429 meeting_daily_cap or directory_daily_cap (design sections 5 and 6).
export function registerMeetHelper(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.asks.meetHelper.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = AnswerParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const body = AnswerMeetingCreate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const meetingId = await meetHelper(deps, { personId, askId: params.data.id, answerId: params.data.answerId, cardId: body.data.cardId });
    return reply.code(201).send(MeetingCreateResponse.parse({ meetingId }));
  });
}
