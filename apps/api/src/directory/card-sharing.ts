// The sharing settings of one card: which approved items the directory may show, and whether
// friends may ask the persona how its person would probably react. Only the card's owner reads or
// changes them.
import type { FastifyInstance } from "fastify";
import type { Transaction } from "kysely";
import { z } from "zod";
import { CardSharing, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of the two sharing routes: a uuid, or the card cannot exist.
const CardParams = z.object({ id: Uuid });
// The sentence for a public position that is not an approved item whose quote was found.
const POSITION_NOT_SHAREABLE_SENTENCE = "Only approved items with a found quote can be public.";
// meeting_create's own sentence for card_not_approved, used for the same code here and on PUT
// /api/directory/me.
const CARD_NOT_APPROVED_SENTENCE = "approve your card before creating a meeting.";

// What one sharing change is checked against: the caller's card, the positions that may be public,
// the positions asked for, and whether the caller's listing uses this card.
export type SharingCheck = {
  card: { state: string } | undefined;
  shareablePositions: ReadonlySet<number>;
  requestedPositions: readonly number[];
  isListedCard: boolean;
};

// card_not_approved, 409: the card is not the caller's approved card.
export function makeCardNotApprovedError(): ContractError {
  return new ContractError("card_not_approved", CARD_NOT_APPROVED_SENTENCE, HTTP.conflict);
}

// listing_needs_public_item, 409: a listed card keeps at least one public item, because strangers
// see only public items.
export function makeListingNeedsPublicItemError(): ContractError {
  return new ContractError(
    "listing_needs_public_item",
    "To stay in Explore you need at least one public item. Mark one, or leave Explore first.",
    HTTP.conflict,
  );
}

// Locks the caller's people row before any check, so one person's sharing changes and listing
// changes take turns, and two requests sent at once cannot leave a listed card with no public item.
export async function lockPersonRow(trx: Transaction<Database>, personId: string): Promise<void> {
  await trx.selectFrom("people").select("id").where("id", "=", personId).forUpdate().execute();
}

// Refuses a sharing change, in this order: not the caller's card (404), a card not approved (409),
// a position that may not be public (400), a listed card left with no public item (409).
export function assertCanShare(check: SharingCheck): void {
  if (check.card === undefined) throw makeNotFoundError();
  if (check.card.state !== "approved") throw makeCardNotApprovedError();
  if (check.requestedPositions.some((position) => !check.shareablePositions.has(position))) {
    throw new ContractError("payload_invalid", POSITION_NOT_SHAREABLE_SENTENCE, HTTP.badRequest);
  }
  if (check.isListedCard && check.requestedPositions.length === 0)
    throw makeListingNeedsPublicItemError();
}

// Reads one card's sharing settings as its owner: the friends switch and the public positions in
// position order; null when the card is not the caller's.
export async function readCardSharing(
  trx: Transaction<Database>,
  input: { cardId: string; personId: string },
): Promise<CardSharing | null> {
  const card = await trx
    .selectFrom("cards")
    .select("friends_can_ask")
    .where("id", "=", input.cardId)
    .where("person_id", "=", input.personId)
    .executeTakeFirst();
  if (card === undefined) return null;
  const rows = await trx
    .selectFrom("card_items")
    .select("position")
    .where("card_id", "=", input.cardId)
    .where("is_public", "=", true)
    .orderBy("position", "asc")
    .execute();
  return CardSharing.parse({
    friendsCanAsk: card.friends_can_ask,
    publicPositions: rows.map((row) => row.position),
  });
}

// Writes a checked change: every item of the card that was not chosen becomes private, the chosen
// ones public, then the friends switch is set. In words: an empty choice runs one UPDATE over the
// whole card, because a "position in" list may not be empty; otherwise two UPDATEs split the card
// by position.
export async function applySharing(
  trx: Transaction<Database>,
  change: { cardId: string; positions: readonly number[]; friendsCanAsk: boolean },
): Promise<void> {
  const positions = [...change.positions];
  if (positions.length === 0) {
    await trx
      .updateTable("card_items")
      .set({ is_public: false })
      .where("card_id", "=", change.cardId)
      .execute();
  } else {
    await trx
      .updateTable("card_items")
      .set({ is_public: false })
      .where("card_id", "=", change.cardId)
      .where("position", "not in", positions)
      .execute();
    await trx
      .updateTable("card_items")
      .set({ is_public: true })
      .where("card_id", "=", change.cardId)
      .where("position", "in", positions)
      .execute();
  }
  await trx
    .updateTable("cards")
    .set({ friends_can_ask: change.friendsCanAsk })
    .where("id", "=", change.cardId)
    .execute();
}

// Registers GET /api/cards/:id/sharing: 200 CardSharing; 404 not_found when the card is not the
// caller's or the id is not a uuid.
export function registerReadSharing(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.directory.readSharing.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = CardParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const sharing = await withPerson(deps.db, personId, (trx) =>
      readCardSharing(trx, { cardId: params.data.id, personId }),
    );
    if (sharing === null) throw makeNotFoundError();
    return reply.code(200).send(sharing);
  });
}

// Registers PUT /api/cards/:id/sharing: 200 CardSharing; 400 payload_invalid; 404 not_found; 409
// card_not_approved or listing_needs_public_item.
export function registerUpdateSharing(app: FastifyInstance, deps: RouteDeps): void {
  app.put(routes.directory.updateSharing.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = CardParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const body = CardSharing.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const cardId = params.data.id;
    const positions = [...new Set(body.data.publicPositions)].sort((left, right) => left - right);
    const sharing = await withPerson(deps.db, personId, async (trx) => {
      await lockPersonRow(trx, personId);
      const card = await trx
        .selectFrom("cards")
        .select("state")
        .where("id", "=", cardId)
        .where("person_id", "=", personId)
        .executeTakeFirst();
      const shareable = await trx
        .selectFrom("card_items")
        .select("position")
        .where("card_id", "=", cardId)
        .where("approved", "=", true)
        .where("verified", "=", true)
        .execute();
      const listing = await trx
        .selectFrom("directory_listings")
        .select("id")
        .where("person_id", "=", personId)
        .where("card_id", "=", cardId)
        .executeTakeFirst();
      assertCanShare({
        card,
        shareablePositions: new Set(shareable.map((row) => row.position)),
        requestedPositions: positions,
        isListedCard: listing !== undefined,
      });
      await applySharing(trx, { cardId, positions, friendsCanAsk: body.data.friendsCanAsk });
      return readCardSharing(trx, { cardId, personId });
    });
    if (sharing === null) throw makeNotFoundError();
    return reply.code(200).send(sharing);
  });
}
