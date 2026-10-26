import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CARD_ITEMS_MAX, CardItem, CardItemSource, CardView, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import { buildOffsetMap, normQuote, originalSlice } from "@meet-first/receipts";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The card row the view reads.
export type CardRow = { id: string; source_id: string; state: CardView["state"]; thin: boolean; recall_allowed: boolean; items_total: number | null; items_verified: number | null; built_at: Date | null };
// One card_items row the view reads.
export type CardItemRow = { id: string; position: number; kind: CardItem["kind"]; claim: string; lang: string; gloss: string; turn_id: string; quote: string; verified: boolean; flagged: boolean; approved: boolean; sensitive: boolean };
// The params of the card route: a uuid id.
const CardParams = z.object({ id: Uuid });
// The params of the item source route: the card id and the item's 1-based position.
export const ItemSourceParams = z.object({ id: z.string().uuid(), position: z.coerce.number().int().min(1).max(CARD_ITEMS_MAX) });
// One item joined to its turn, as the item source route reads them.
export type ItemSourceRow = { quote: string; turn_index: number; text: string };

// One item row as the screen gets it (contracts CardItem).
export function toCardItem(row: CardItemRow): CardItem {
  return { id: row.id, position: row.position, kind: row.kind, claim: row.claim, lang: row.lang, gloss: row.gloss, turnId: row.turn_id, quote: row.quote, verified: row.verified, flagged: row.flagged, approved: row.approved, sensitive: row.sensitive };
}

// The card and its items as CardView, with the server time (R3.4).
export function toCardView(card: CardRow, items: readonly CardItemRow[], serverNow: Date): CardView {
  return CardView.parse({
    id: card.id,
    sourceId: card.source_id,
    state: card.state,
    thin: card.thin,
    recallAllowed: card.recall_allowed,
    itemsTotal: card.items_total,
    itemsVerified: card.items_verified,
    items: items.map(toCardItem),
    builtAt: card.built_at === null ? null : card.built_at.toISOString(),
    serverNow: serverNow.toISOString(),
  });
}

// Registers GET /api/cards/:id: 200 CardView; 404 not_found.
export function registerReadCard(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(routes.cards.readCard.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = CardParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const cardId = params.data.id;
    const view = await withPerson(deps.db, personId, async (trx) => {
      const card = await trx.selectFrom("cards").select(["id", "source_id", "state", "thin", "recall_allowed", "items_total", "items_verified", "built_at"]).where("id", "=", cardId).executeTakeFirst();
      if (card === undefined) throw makeNotFoundError();
      const items = await trx.selectFrom("card_items").select(["id", "position", "kind", "claim", "lang", "gloss", "turn_id", "quote", "verified", "flagged", "approved", "sensitive"]).where("card_id", "=", cardId).orderBy("position", "asc").execute();
      return toCardView(card, items, deps.now());
    });
    return reply.code(200).send(view);
  });
  return Promise.resolve();
}

// Where an item's quote sits in its turn's original text, through the receipts offset map; null when the quote is not in the turn (R3.2, D7).
export function highlightFor(turnText: string, quote: string): CardItemSource["highlight"] {
  const map = buildOffsetMap(turnText);
  const needle = normQuote(quote);
  const index = map.normalised.indexOf(needle);
  if (index < 0) return null;
  const slice = originalSlice(map, index, index + needle.length);
  return { start: slice.start, end: slice.end };
}

// One item's source message as the owner's card screen gets it (contracts CardItemSource).
export function toCardItemSource(row: ItemSourceRow): CardItemSource {
  return CardItemSource.parse({ turnIndex: row.turn_index, text: row.text, highlight: highlightFor(row.text, row.quote) });
}

// Registers GET /api/cards/:id/items/:position/source: 200 CardItemSource; 404 not_found.
export function registerReadItemSource(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(routes.cards.readItemSource.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = ItemSourceParams.safeParse(request.params);
    if (!params.success) throw new ContractError("not_found", "This no longer exists or is not yours.", HTTP.notFound);
    const row = await withPerson(deps.db, personId, (trx) =>
      trx.selectFrom("card_items").innerJoin("turns", "turns.id", "card_items.turn_id").select(["card_items.quote", "turns.turn_index", "turns.text"]).where("card_items.card_id", "=", params.data.id).where("card_items.position", "=", params.data.position).executeTakeFirst(),
    );
    if (row === undefined) throw makeNotFoundError();
    return reply.code(200).send(toCardItemSource(row));
  });
  return Promise.resolve();
}
