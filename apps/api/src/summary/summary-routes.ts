// A person's summary, written by their own AI from Meety's prompt and pasted in. The text is stored canonical and scrubbed by code
// (secrets, emails, phone numbers), with the person's own names left alone, and the check_summary job then replaces other people's
// names and checks each point's quotes against the person's own messages. Saving clears the old points until that job runs again.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { ContractError, HTTP, routes, SUMMARY_MAX_CHARS, SUMMARY_SAVES_PER_DAY, SummaryPointView, SummarySave, SummaryView } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import { canonicalise } from "@meet-first/parsers";
import { makePlaceholderCounter, scrub } from "@meet-first/scrub";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The sentence for a save past the day's cap.
const DAILY_CAP_SENTENCE = `You saved your summary ${String(SUMMARY_SAVES_PER_DAY)} times today. Try again tomorrow.`;

// One person_summaries row as these routes read it.
type SummaryRow = { points: unknown; state: "checking" | "ready" | "failed"; friends_can_ask: boolean; updated_at: Date };
// What one save stores: the scrubbed text and the switch.
type SummaryInput = { personId: string; text: string; friendsCanAsk: boolean };

// The view of one stored summary; points stored in another shape are left out rather than shown wrong.
function viewOf(row: SummaryRow): SummaryView {
  const points = z.array(SummaryPointView).safeParse(row.points);
  return SummaryView.parse({ state: row.state, points: points.success ? points.data : [], friendsCanAsk: row.friends_can_ask, updatedAt: row.updated_at.toISOString() });
}

// An opening square bracket that would make typed text look like a placeholder or a role token, which the names check leaves alone.
const TOKEN_SHAPED = /\[(?=\s*(?:person|code|redacted)\s*:)/giu;

// The text as it is stored: token-shaped brackets the person typed turned round, so no name can hide inside one; then canonical, then
// scrubbed by code with the person's own names left alone. Only the scrub writes placeholders.
function scrubbedText(text: string, allowlist: readonly string[]): string {
  return scrub(canonicalise(text.replace(TOKEN_SHAPED, "(")), { allowlist, nextId: makePlaceholderCounter() }).text;
}

// Counts one save on the person, unless they already saved SUMMARY_SAVES_PER_DAY times this UTC day; false at the cap. The count
// lives on the person, so deleting the summary does not reset it, and the row lock makes two saves at once take turns.
async function countSave(trx: DatabaseTransaction, personId: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    UPDATE people SET
      summary_saves_today = CASE WHEN summary_save_day = (now() AT TIME ZONE 'UTC')::date THEN summary_saves_today + 1 ELSE 1 END,
      summary_save_day = (now() AT TIME ZONE 'UTC')::date
    WHERE id = ${personId} AND (summary_save_day IS DISTINCT FROM (now() AT TIME ZONE 'UTC')::date OR summary_saves_today < ${SUMMARY_SAVES_PER_DAY})
    RETURNING id`.execute(trx);
  return result.rows.length > 0;
}

// Saves the summary with its points cleared and state checking; the saved row.
async function upsertSummary(trx: DatabaseTransaction, input: SummaryInput): Promise<SummaryRow> {
  const result = await sql<SummaryRow>`
    INSERT INTO person_summaries (person_id, text, friends_can_ask) VALUES (${input.personId}, ${input.text}, ${input.friendsCanAsk})
    ON CONFLICT (person_id) DO UPDATE SET text = EXCLUDED.text, friends_can_ask = EXCLUDED.friends_can_ask, points = '[]', state = 'checking', updated_at = now()
    RETURNING points, state, friends_can_ask, updated_at`.execute(trx);
  const row = result.rows[0];
  if (row === undefined) throw new ContractError("summary_not_saved", "The summary was not saved. Try again.", HTTP.internal);
  return row;
}

// Registers PUT /api/people/me/summary: 202 SummaryView, checking, and a check_summary job queued after the save commits; 400 for an
// empty or too long text; 429 summary_daily_cap past the day's saves.
function registerSaveSummary(app: FastifyInstance, deps: RouteDeps): void {
  app.put(routes.people.saveSummary.path, async (request, reply) => {
    const personId = requirePerson(request);
    const body = SummarySave.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const row = await withPerson(deps.db, personId, async (trx) => {
      const person = await trx.selectFrom("people").select(["display_name", "affiliations"]).where("id", "=", personId).executeTakeFirstOrThrow();
      const text = scrubbedText(body.data.text, [person.display_name, ...person.affiliations]);
      if (text.length > SUMMARY_MAX_CHARS) throw makePayloadInvalidError();
      if (!(await countSave(trx, personId))) return undefined;
      return upsertSummary(trx, { personId, text, friendsCanAsk: body.data.friendsCanAsk });
    });
    if (row === undefined) throw new ContractError("summary_daily_cap", DAILY_CAP_SENTENCE, HTTP.tooMany);
    await deps.enqueue("check_summary", { personId });
    return reply.code(202).send(viewOf(row));
  });
}

// Registers GET /api/people/me/summary (200 SummaryView, or 404 when there is none) and DELETE (204, whether or not there was one).
function registerReadAndDelete(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.people.readSummary.path, async (request, reply) => {
    const personId = requirePerson(request);
    const row = await withPerson(deps.db, personId, (trx) =>
      trx.selectFrom("person_summaries").select(["points", "state", "friends_can_ask", "updated_at"]).where("person_id", "=", personId).executeTakeFirst(),
    );
    if (row === undefined) throw makeNotFoundError();
    return reply.code(200).send(viewOf(row));
  });
  app.delete(routes.people.deleteSummary.path, async (request, reply) => {
    const personId = requirePerson(request);
    await withPerson(deps.db, personId, (trx) => trx.deleteFrom("person_summaries").where("person_id", "=", personId).execute());
    return reply.code(204).send();
  });
}

// Registers the three summary routes.
export function registerSummary(app: FastifyInstance, deps: RouteDeps): void {
  registerSaveSummary(app, deps);
  registerReadAndDelete(app, deps);
}
