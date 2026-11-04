import type { FastifyInstance } from "fastify";
import type { Transaction } from "kysely";
import { z } from "zod";
import {
  CARDS_PER_SOURCE_PER_DAY,
  CardRequestResponse,
  ContractError,
  HTTP,
  routes,
  Uuid,
} from "@meet-first/contracts";
import {
  numberFromPostgres,
  withPerson,
  type Database,
  type DatabaseTransaction,
} from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// What cards.model and cards.prompt_version hold until the job builds the card, because apps/api imports neither packages/llm nor packages/prompts.
export const CARD_PENDING_LABEL = "pending";
// The :id of POST /api/sources/:id/cards: a uuid, or the source cannot exist.
const RouteParams = z.object({ id: Uuid });

// The UTC midnight before now, where the 2-builds-a-day count restarts (the same boundary as the dollar caps of packages/llm).
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Refuses a card request: no such source for this person, a source not yet frozen, or 2 builds today already.
export function assertCanRequestCard(
  source: { frozen_at: Date | null } | undefined,
  buildsToday: number,
): void {
  if (source === undefined) throw makeNotFoundError();
  if (source.frozen_at === null)
    throw new ContractError(
      "source_not_frozen",
      "Finish the names review before building a card.",
      HTTP.conflict,
    );
  if (buildsToday >= CARDS_PER_SOURCE_PER_DAY) {
    throw new ContractError(
      "card_daily_cap",
      `This source already had ${String(CARDS_PER_SOURCE_PER_DAY)} card builds today. Try again after midnight UTC.`,
      HTTP.tooMany,
    );
  }
}

// Inserts the card in state building and returns its id; the job writes the model and the prompt version when it builds.
export async function insertBuildingCard(
  trx: DatabaseTransaction | Transaction<Database>,
  args: { sourceId: string; personId: string },
): Promise<string> {
  const row = await trx
    .insertInto("cards")
    .values({
      source_id: args.sourceId,
      person_id: args.personId,
      state: "building",
      model: CARD_PENDING_LABEL,
      prompt_version: CARD_PENDING_LABEL,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Registers POST /api/sources/:id/cards: 202 CardRequestResponse; 404 not_found; 409 source_not_frozen; 429 card_daily_cap.
export function registerRequestBuild(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(routes.sources.requestCard.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = RouteParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const sourceId = params.data.id;
    const cardId = await withPerson(deps.db, personId, async (trx) => {
      // The source row is locked first, so requests for one source take turns and the daily count cannot be passed by sending several at once.
      const source = await trx
        .selectFrom("sources")
        .select(["id", "frozen_at"])
        .where("id", "=", sourceId)
        .forUpdate()
        .executeTakeFirst();
      const count = await trx
        .selectFrom("cards")
        .select((eb) => eb.fn.countAll<string>().as("builds"))
        .where("source_id", "=", sourceId)
        .where("created_at", ">=", utcDayStart(deps.now()))
        .executeTakeFirstOrThrow();
      assertCanRequestCard(source, numberFromPostgres(count.builds));
      return insertBuildingCard(trx, { sourceId, personId });
    });
    try {
      await deps.enqueue("build_card", { cardId, personId });
    } catch (error) {
      await withPerson(deps.db, personId, (trx) =>
        trx
          .updateTable("cards")
          .set({ state: "failed", error: "enqueue_failed" })
          .where("id", "=", cardId)
          .where("state", "=", "building")
          .execute(),
      );
      throw error;
    }
    return reply.code(202).send(CardRequestResponse.parse({ cardId }));
  });
  return Promise.resolve();
}
