// What exists: Explore lists people, and an invite link makes two people friends. The problem: a person should be able to ask someone
// they found in Explore to be friends, and the other must say yes first. The step: four routes over the definer functions of migration
// 0008, which check the caller, the listing, the friendship, a request already waiting and the daily cap. Accepting makes the same
// joined pair an invite makes, so every friend feature works for request friends unchanged. What they do not do: show anyone's person
// id, or let a person ask someone Explore does not show.
import type { FastifyInstance } from "fastify";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { ContractError, FRIEND_REQUESTS_PER_DAY, FriendRequestAcceptResponse, FriendRequestCreate, FriendRequestCreateResponse, FriendRequestsView, HTTP, routes, Uuid } from "@meet-first/contracts";
import { parseDatabaseError, withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of the accept and decline routes: a request id. One that is not a uuid is not_found, so a bad id tells nothing.
const RequestParams = z.object({ id: Uuid });
// The refusals of the friend request functions with the status each answers; the sentence is the database's own (migration 0008).
const FRIEND_REQUEST_REFUSAL_STATUS: ReadonlyMap<string, number> = new Map<string, number>([
  ["listing_not_found", HTTP.notFound],
  ["friend_request_not_found", HTTP.notFound],
  ["friend_request_self", HTTP.conflict],
  ["already_friends", HTTP.conflict],
  ["friend_request_pending", HTTP.conflict],
  ["friend_request_decided", HTTP.conflict],
  ["friend_request_daily_cap", HTTP.tooMany],
]);

// One row of friend_requests_mine by its SQL names (migration 0008).
type RequestRow = { request_id: string; direction: "incoming" | "outgoing"; other_display_name: string; other_listing_id: string | null; created_at: Date };

// The error to send for a refusal of a friend request function, with the database's sentence, or null for any other error.
export function toFriendRequestError(error: unknown): ContractError | null {
  const refusal = parseDatabaseError(error);
  if (refusal === null) return null;
  const status = FRIEND_REQUEST_REFUSAL_STATUS.get(refusal.code);
  return status === undefined ? null : new ContractError(refusal.code, refusal.message, status);
}

// Runs one friend request function call, turning its refusals into route errors and letting every other error through.
async function callRefusing<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toFriendRequestError(error) ?? error;
  }
}

// The caller's pending requests both ways, newest first, as friend_requests_mine returns them.
export async function readFriendRequests(trx: Transaction<Database>): Promise<FriendRequestsView> {
  const result = await sql<RequestRow>`SELECT request_id, direction, other_display_name, other_listing_id, created_at FROM friend_requests_mine()`.execute(trx);
  const views = result.rows.map((row) => ({ requestId: row.request_id, direction: row.direction, otherName: row.other_display_name, otherListingId: row.other_listing_id, createdAt: row.created_at.toISOString() }));
  return FriendRequestsView.parse({ incoming: views.filter((view) => view.direction === "incoming"), outgoing: views.filter((view) => view.direction === "outgoing") });
}

// Registers GET /api/friend-requests: 200 FriendRequestsView, the caller's pending requests, received and sent. Never cached, because a request can be answered at any moment.
export function registerListFriendRequests(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listFriendRequests.path, async (request, reply) => {
    const personId = requirePerson(request);
    const view = await withPerson(deps.db, personId, (trx) => readFriendRequests(trx));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(view);
  });
}

// Registers POST /api/friend-requests: 201 {requestId}; 400 payload_invalid; 404 listing_not_found; 409 friend_request_self, already_friends or friend_request_pending; 429 friend_request_daily_cap.
export function registerSendFriendRequest(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.social.sendFriendRequest.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = FriendRequestCreate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const requestId = await withPerson(deps.db, personId, (trx) => callRefusing(async () => {
      const result = await sql<{ request_id: string }>`SELECT friend_request_send(${body.data.listingId}::uuid, ${FRIEND_REQUESTS_PER_DAY}::int) AS request_id`.execute(trx);
      return result.rows[0]?.request_id;
    }));
    if (requestId === undefined) throw new ContractError("friend_request_failed", "The request could not be sent. Try again.", HTTP.internal);
    return reply.code(201).send(FriendRequestCreateResponse.parse({ requestId }));
  });
}

// Registers POST /api/friend-requests/:id/accept: 200 {pairId}, the pair that now makes the two people friends; 404 not_found or friend_request_not_found; 409 friend_request_decided.
export function registerAcceptFriendRequest(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.social.acceptFriendRequest.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = RequestParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const pairId = await withPerson(deps.db, personId, (trx) => callRefusing(async () => {
      const result = await sql<{ pair_id: string }>`SELECT friend_request_accept(${params.data.id}::uuid) AS pair_id`.execute(trx);
      return result.rows[0]?.pair_id;
    }));
    if (pairId === undefined) throw new ContractError("friend_request_failed", "The request could not be accepted. Try again.", HTTP.internal);
    return reply.code(200).send(FriendRequestAcceptResponse.parse({ pairId }));
  });
}

// Registers POST /api/friend-requests/:id/decline: 204; 404 not_found or friend_request_not_found; 409 friend_request_decided.
export function registerDeclineFriendRequest(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.social.declineFriendRequest.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = RequestParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    await withPerson(deps.db, personId, (trx) => callRefusing(() => sql`SELECT friend_request_decline(${params.data.id}::uuid)`.execute(trx)));
    return reply.code(204).send();
  });
}
