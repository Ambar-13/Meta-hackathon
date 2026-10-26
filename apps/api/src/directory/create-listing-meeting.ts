// A meeting with a listed persona, asked for from the directory. The caller's own daily cap is checked first; then
// directory_meeting_create makes the meeting with its own pair, both go-aheads given, the listed side public-only and the
// question's kind set (design sections 5, 6 and 11).
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { ContractError, DIRECTORY_MEETINGS_PER_LISTING_PER_DAY, HTTP, MeetingCreate, MeetingCreateResponse, routes, Uuid } from "@meet-first/contracts";
import { parseDatabaseError, withPerson, type Database, type DatabaseRefusal } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { assertUnderDailyMeetingCap, questionFromBody } from "../meetings/create-meeting.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of POST /api/directory/:id/meetings: a listing id. One that is not a uuid is not_found, as on the pairs route [confirm].
const ListingParams = z.object({ id: Uuid });
// The five refusals of directory_meeting_create with the status each answers; the sentence is the database's own (design sections 6 and 11).
const LISTING_MEETING_REFUSAL_STATUS: ReadonlyMap<string, number> = new Map<string, number>([
  ["listing_not_found", HTTP.notFound],
  ["directory_self", HTTP.conflict],
  ["romance_not_open", HTTP.conflict],
  ["card_not_approved", HTTP.conflict],
  ["directory_daily_cap", HTTP.tooMany],
]);

// What one directory meeting needs: the listing, the caller, the caller's card and the question as questionFromBody reads it.
type ListingMeetingInput = { listingId: string; personId: string; cardId: string; question: ReturnType<typeof questionFromBody> };

// The error to send for a refusal read off directory_meeting_create, with the database's sentence, or null when the refusal is not one of its five.
export function toListingMeetingError(refusal: DatabaseRefusal | null): ContractError | null {
  if (refusal === null) return null;
  const status = LISTING_MEETING_REFUSAL_STATUS.get(refusal.code);
  if (status === undefined) return null;
  return new ContractError(refusal.code, refusal.message, status);
}

// Calls directory_meeting_create as the caller with the listing's daily cap, and returns the meeting id. The function sets question_kind itself (the curated kind, or situation for free text), so nothing here writes it (design section 11).
async function createListingMeetingRow(trx: Transaction<Database>, input: ListingMeetingInput): Promise<string> {
  const { question } = input;
  let meetingId: string | null | undefined;
  try {
    const result = await sql<{ meeting_id: string | null }>`SELECT directory_meeting_create(${input.listingId}::uuid, ${input.personId}::uuid, ${input.cardId}::uuid, ${question.questionId}::int, ${question.text}, ${question.isChecked}, ${question.kind}::text, ${DIRECTORY_MEETINGS_PER_LISTING_PER_DAY}) AS meeting_id`.execute(trx);
    meetingId = result.rows[0]?.meeting_id;
  } catch (error) {
    const refusal = toListingMeetingError(parseDatabaseError(error));
    if (refusal !== null) throw refusal;
    throw error;
  }
  if (meetingId === null || meetingId === undefined) throw new ContractError("meeting_create_failed", "The meeting could not be created. Try again.", HTTP.internal);
  return meetingId;
}

// Registers POST /api/directory/:id/meetings: 201 {meetingId}; 400 payload_invalid; 404 not_found or listing_not_found; 409 directory_self, romance_not_open or card_not_approved; 429 meeting_daily_cap or directory_daily_cap (design sections 5, 6 and 11).
export function registerCreateListingMeeting(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.directory.createListingMeeting.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = ListingParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const body = MeetingCreate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const question = questionFromBody(body.data);
    const meetingId = await withPerson(deps.db, personId, async (trx) => {
      await assertUnderDailyMeetingCap(trx, personId, deps.now());
      return createListingMeetingRow(trx, { listingId: params.data.id, personId, cardId: body.data.cardId, question });
    });
    await deps.enqueue("check_question", { meetingId });
    return reply.code(201).send(MeetingCreateResponse.parse({ meetingId }));
  });
}
