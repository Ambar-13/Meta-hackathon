import type { FastifyInstance } from "fastify";
import { ContractError, HTTP, NamesReview, NamesReviewResponse, routes, SENSITIVE_CATEGORIES, TURN_TEXT_MAX_CHARS } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import { normQuote } from "@meet-first/receipts";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { SourceParams } from "./read-source.js";

// One name the names pass found and the person may keep: its text, its role token and the placeholder ids of its redactions.
export type VisibleName = { text: string; roleToken: string; placeholderIds: string[] };
// What a review changes: the kept names to put back into the text, and the sensitive categories to keep in (D18).
export type ReviewPlan = { keptNames: VisibleName[]; sensitiveOptIn: NamesReview["sensitiveOptIn"] };

// The sentence for a sensitive category outside the four the person may keep in (D18).
const SENSITIVE_INVALID_SENTENCE = "Only health, minor, address and identifier can be kept in. Remove the other choice and send again.";
// The sentence for a review that names a name the pass did not find, or a minor's name.
const UNKNOWN_NAME_SENTENCE = "A name in the review is not on this source's list. Reload the list and review again.";
// The sentence for a source that already holds a freeze.
const ALREADY_FROZEN_SENTENCE = "This source was already reviewed and frozen. Upload it again to review it differently.";
// The sentence for a review sent before the names check has finished.
const NAMES_RUNNING_SENTENCE = "The names check is still running. Wait a few seconds and send the review again.";
// The sentence for a kept name that would make a message longer than the turn limit.
const TURN_TOO_LONG_SENTENCE = "Putting a kept name back would make a message longer than 20,000 characters. Replace that name instead.";

// True when a category is one the person may opt into (D18).
function isSensitive(category: string): boolean {
  return (SENSITIVE_CATEGORIES as readonly string[]).includes(category);
}

// Refuses an opt-in outside the sensitive list, and drops repeats, keeping the first (D18).
function sensitiveOptInOf(categories: NamesReview["sensitiveOptIn"]): NamesReview["sensitiveOptIn"] {
  if (!categories.every(isSensitive)) {
    throw new ContractError("sensitive_category_invalid", SENSITIVE_INVALID_SENTENCE, HTTP.unprocessable);
  }
  return [...new Set(categories)];
}

// Refuses a review that gives two decisions for one name (R2.4).
function checkDecisionsUnique(decisions: NamesReview["decisions"]): void {
  const texts = decisions.map((decision) => decision.text);
  if (new Set(texts).size !== texts.length) throw makePayloadInvalidError();
}

// Refuses a decision for a name the pass did not find for this source, or for a minor's name, which is never listed (R2.4, D18).
function checkDecisionsVisible(decisions: NamesReview["decisions"], visibleNames: readonly VisibleName[]): void {
  const visible = new Set(visibleNames.map((name) => name.text));
  if (decisions.some((decision) => !visible.has(decision.text))) {
    throw new ContractError("names_review_unknown_name", UNKNOWN_NAME_SENTENCE, HTTP.unprocessable);
  }
}

// Checks a review against the names the pass found, refusing unknown names and categories outside the sensitive list (D17, D18).
export function planReview(review: NamesReview, visibleNames: readonly VisibleName[]): ReviewPlan {
  const sensitiveOptIn = sensitiveOptInOf(review.sensitiveOptIn);
  checkDecisionsUnique(review.decisions);
  checkDecisionsVisible(review.decisions, visibleNames);
  const keptTexts = new Set(review.decisions.filter((decision) => decision.keep).map((decision) => decision.text));
  return { keptNames: visibleNames.filter((name) => keptTexts.has(name.text)), sensitiveOptIn };
}

// Puts each kept name back in place of its role token, in every turn of the source, and drops the redactions those names made (R2.4, R2.5).
async function putBackNames(trx: DatabaseTransaction, sourceId: string, kept: VisibleName[]): Promise<void> {
  const turns = await trx.selectFrom("turns").select(["id", "text"]).where("source_id", "=", sourceId).orderBy("turn_index").execute();
  for (const turn of turns) {
    const text = kept.reduce((current, name) => current.split(name.roleToken).join(name.text), turn.text);
    if (text === turn.text) continue;
    if (text.length > TURN_TEXT_MAX_CHARS) throw new ContractError("names_review_turn_too_long", TURN_TOO_LONG_SENTENCE, HTTP.unprocessable);
    await trx.updateTable("turns").set({ text, norm_text: normQuote(text) }).where("id", "=", turn.id).execute();
  }
  const ids = kept.flatMap((name) => name.placeholderIds);
  if (ids.length > 0) {
    await trx.deleteFrom("redactions").where("source_id", "=", sourceId).where("placeholder_id", "in", ids).execute();
  }
}

// Applies a planned review in the caller's transaction: kept names go back, their redaction rows go, and the source freezes (D16).
export async function applyReview(trx: DatabaseTransaction, input: { sourceId: string; plan: ReviewPlan }, now: Date): Promise<{ frozenAt: Date; redactionCount: number }> {
  if (input.plan.keptNames.length > 0) await putBackNames(trx, input.sourceId, input.plan.keptNames);
  const updated = await trx
    .updateTable("sources")
    .set({ sensitive_opt_in: input.plan.sensitiveOptIn, names_reviewed_at: now, frozen_at: now })
    .where("id", "=", input.sourceId)
    .where("frozen_at", "is", null)
    .executeTakeFirst();
  if (updated.numUpdatedRows === 0n) {
    throw new ContractError("source_already_frozen", ALREADY_FROZEN_SENTENCE, HTTP.conflict);
  }
  await trx.deleteFrom("source_names").where("source_id", "=", input.sourceId).execute();
  const counted = await trx.selectFrom("redactions").select((eb) => eb.fn.countAll().as("count")).where("source_id", "=", input.sourceId).executeTakeFirstOrThrow();
  return { frozenAt: now, redactionCount: Number(counted.count) };
}

// Reads the names of a source the review may act on, and refuses the review when the source is missing, frozen or not yet checked (D15, D16).
async function reviewableNames(trx: DatabaseTransaction, sourceId: string): Promise<VisibleName[]> {
  const source = await trx.selectFrom("sources").select(["id", "frozen_at"]).where("id", "=", sourceId).forUpdate().executeTakeFirst();
  if (source === undefined) throw makeNotFoundError();
  if (source.frozen_at !== null) throw new ContractError("source_already_frozen", ALREADY_FROZEN_SENTENCE, HTTP.conflict);
  const pass = await trx.selectFrom("names_passes").select("source_id").where("source_id", "=", sourceId).executeTakeFirst();
  if (pass === undefined) throw new ContractError("names_pass_running", NAMES_RUNNING_SENTENCE, HTTP.conflict);
  const rows = await trx.selectFrom("source_names").select(["text", "role_token", "placeholder_ids"]).where("source_id", "=", sourceId).where("is_minor", "=", false).execute();
  return rows.map((row) => ({ text: row.text, roleToken: row.role_token, placeholderIds: row.placeholder_ids }));
}

// Registers POST /api/sources/:id/names-review: 200 NamesReviewResponse; 400, 404, 409 and 422 as in the table of 4.3.
export function registerNamesReviewRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.sources.namesReview.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = SourceParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const review = NamesReview.safeParse(request.body);
    if (!review.success) throw makePayloadInvalidError();
    const sourceId = params.data.id;
    const result = await withPerson(deps.db, personId, async (trx) => {
      const visible = await reviewableNames(trx, sourceId);
      const plan = planReview(review.data, visible);
      return applyReview(trx, { sourceId, plan }, deps.now());
    });
    return reply.code(200).send(NamesReviewResponse.parse({ frozenAt: result.frozenAt.toISOString(), redactionCount: result.redactionCount }));
  });
}
