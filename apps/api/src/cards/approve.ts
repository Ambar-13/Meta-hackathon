import type { FastifyInstance } from "fastify";
import type { Transaction } from "kysely";
import { z } from "zod";
import { CardApprove, CardApproveResponse, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The params of the approve route: a uuid id.
const CardParams = z.object({ id: Uuid });

// Refuses an approval: no such card, a card still building or failed, a card already approved, no item chosen, or an item not on the card.
export function assertCanApprove(card: { state: string } | undefined, chosenIds: readonly string[], cardItemIds: ReadonlySet<string>): void {
  if (card === undefined) throw makeNotFoundError();
  if (card.state === "building") throw new ContractError("card_not_ready", "The card is still being built. Wait until it is ready, then approve it.", HTTP.conflict);
  if (card.state === "failed") throw new ContractError("card_failed", "This card build failed. Ask for a new card from the same source.", HTTP.conflict);
  if (card.state === "approved") throw new ContractError("card_already_approved", "This card is already approved. Its items cannot change now.", HTTP.conflict);
  if (chosenIds.length === 0) throw new ContractError("card_items_none", "Choose at least one item to approve.", HTTP.badRequest);
  if (chosenIds.some((id) => !cardItemIds.has(id))) throw new ContractError("card_item_unknown", "One of the chosen items is not on this card. Reload the card and choose again.", HTTP.badRequest);
}

// Approves the chosen items, unapproves the rest, then marks the card approved with the recall switch.
export async function applyApproval(trx: Transaction<Database> | DatabaseTransaction, args: { cardId: string; itemIds: readonly string[]; isRecallAllowed: boolean; now: Date }): Promise<void> {
  const chosen = [...new Set(args.itemIds)];
  await trx.updateTable("card_items").set({ approved: true }).where("card_id", "=", args.cardId).where("id", "in", chosen).execute();
  await trx.updateTable("card_items").set({ approved: false }).where("card_id", "=", args.cardId).where("id", "not in", chosen).execute();
  const updated = await trx
    .updateTable("cards")
    .set({ state: "approved", recall_allowed: args.isRecallAllowed, approved_at: args.now })
    .where("id", "=", args.cardId)
    .where("state", "in", ["ready", "thin"])
    .returning("id")
    .executeTakeFirst();
  if (updated === undefined) throw new ContractError("card_not_ready", "The card is still being built. Wait until it is ready, then approve it.", HTTP.conflict);
}

// Registers POST /api/cards/:id/approve: 200 CardApproveResponse; 400 payload_invalid, card_items_none, card_item_unknown; 404 not_found; 409 card_not_ready, card_failed, card_already_approved.
export function registerApprove(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(routes.cards.approveCard.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = CardParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const body = CardApprove.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const cardId = params.data.id;
    const chosen = [...new Set(body.data.itemIds)];
    await withPerson(deps.db, personId, async (trx) => {
      const card = await trx.selectFrom("cards").select(["id", "state"]).where("id", "=", cardId).executeTakeFirst();
      const ids = await trx.selectFrom("card_items").select("id").where("card_id", "=", cardId).execute();
      assertCanApprove(card, chosen, new Set(ids.map((row) => row.id)));
      await applyApproval(trx, { cardId, itemIds: chosen, isRecallAllowed: body.data.recallAllowed, now: deps.now() });
    });
    return reply.code(200).send(CardApproveResponse.parse({ state: "approved" }));
  });
  return Promise.resolve();
}
