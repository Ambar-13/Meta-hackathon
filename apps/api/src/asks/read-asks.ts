// What exists: the asker polls one ask while run_ask works, and every person reads a list of their own asks and of the answers
// their persona gave. The problem: each person may read only their own asks, and only the copies where their own persona answered.
// The step: both routes read inside withPerson, where the row policies of persona_asks and persona_answers show exactly those rows,
// and every query names its person as well. What they do not do: show pending or failed answers, or any id of the other person.
import type { FastifyInstance } from "fastify";
import type { Transaction } from "kysely";
import { z } from "zod";
import { AsksView, AskView, routes, Uuid } from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { sortAnswersForView, toAboutMeAnswer, toAskAnswer, toAskSummary } from "./ask-rows.js";

// The most asks, and the most copies, that GET /api/asks returns, each newest first.
const ASKS_LIST_MAX = 50;
// The :id of GET /api/asks/:id. A value that is not a uuid is not_found, so a bad id tells nothing.
const AskParams = z.object({ id: Uuid });

// Reads one of the caller's own asks with its answered rows in view order, or null when the caller has no ask with this id.
async function readAskView(
  trx: Transaction<Database>,
  input: { personId: string; askId: string },
): Promise<AskView | null> {
  const ask = await trx
    .selectFrom("persona_asks")
    .select(["id", "mode", "text", "state", "refused_reason", "about_name", "created_at"])
    .where("id", "=", input.askId)
    .where("person_id", "=", input.personId)
    .executeTakeFirst();
  if (ask === undefined) return null;
  const rows = await trx
    .selectFrom("persona_answers")
    .select([
      "id",
      "state",
      "subject_display_name",
      "subject_line",
      "answer",
      "has_sign",
      "claims",
      "position",
      "listing_id",
      "shortlist_rank",
    ])
    .where("ask_id", "=", input.askId)
    .where("asker_person_id", "=", input.personId)
    .where("state", "=", "answered")
    .execute();
  return AskView.parse({
    askId: ask.id,
    mode: ask.mode,
    text: ask.text,
    state: ask.state,
    refusedReason: ask.refused_reason,
    aboutName: ask.about_name,
    answers: sortAnswersForView(rows).map((row) => toAskAnswer(ask, row)),
    createdAt: ask.created_at.toISOString(),
  });
}

// Reads the caller's own asks and the answered copies of their persona, each newest first and at most ASKS_LIST_MAX. A self ask's answer
// is the caller's own ask, so it is not a copy.
async function readAsksView(trx: Transaction<Database>, personId: string): Promise<AsksView> {
  const asked = await trx
    .selectFrom("persona_asks")
    .select(["id", "mode", "text", "state", "created_at"])
    .where("person_id", "=", personId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(ASKS_LIST_MAX)
    .execute();
  const copies = await trx
    .selectFrom("persona_answers")
    .select(["id", "mode", "ask_text", "asker_display_name", "answer", "claims", "created_at"])
    .where("subject_person_id", "=", personId)
    .where("mode", "!=", "self")
    .where("state", "=", "answered")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(ASKS_LIST_MAX)
    .execute();
  return AsksView.parse({
    asked: asked.map((row) => toAskSummary(row)),
    aboutMe: copies.map((row) => toAboutMeAnswer(row)),
  });
}

// Registers GET /api/asks/:id: 200 AskView to the asker only; 404 not_found to anyone else, for a missing ask and for a bad id.
// Never cached, because the ask changes while run_ask works.
export function registerReadAsk(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.asks.readAsk.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = AskParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const view = await withPerson(deps.db, personId, (trx) =>
      readAskView(trx, { personId, askId: params.data.id }),
    );
    if (view === null) throw makeNotFoundError();
    reply.header("cache-control", "no-store");
    return reply.code(200).send(view);
  });
}

// Registers GET /api/asks: 200 AsksView with the caller's asks and their persona's copies. Never cached, because both lists change
// while asks run.
export function registerListAsks(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.asks.listAsks.path, async (request, reply) => {
    const personId = requirePerson(request);
    const view = await withPerson(deps.db, personId, (trx) => readAsksView(trx, personId));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(view);
  });
}
