import {
  CARD_INPUT_MAX_CHARS,
  CARD_ITEMS_MIN,
  CardBuildOutput,
  ContractError,
  type JobPayload,
} from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import {
  buildChatRequest,
  CALL_SITE_CONFIG,
  CapReached,
  CHAT_MODEL,
  LimiterBusy,
  requestChars,
} from "@meet-first/llm";
import { currentVersion } from "@meet-first/prompts";
import type { Kysely } from "kysely";
import type { JobContext, JobTask } from "../job-context.js";
import { cardCall, cardRegenerationCall, sampleTurns, type SampledTurn } from "./turn-sampler.js";
import type { ModelCall } from "./name-chunks.js";
import {
  mergeVerified,
  verifyItems,
  type FailedItem,
  type ItemCheck,
  type VerifiedItem,
} from "./verify-items.js";

// One source row as the card build reads it.
type SourceRow = {
  id: string;
  frozen_at: Date | null;
  sensitive_opt_in: string[];
  chars_per_token: string | null;
};
// One turn row as the card build reads it.
type TurnRow = {
  id: string;
  turn_index: number;
  text: string;
  norm_text: string;
  sensitive_categories: string[];
};
// What the build reads before any model call: the card's source and turns, or "stop" when there is
// nothing to do.
type CardInput = { source: SourceRow | undefined; turns: TurnRow[] } | "stop";
// The numbers and items one finished card build writes.
type CardResult = {
  itemsTotal: number;
  final: VerifiedItem[];
  isThin: boolean;
  charsPerToken: number | null;
  sourceId: string;
  promptVersion: string;
};
// The job's own context for one build: the first card call, its checks and the turns it may quote.
type BuildPlan = {
  first: ModelCall;
  sampled: SampledTurn[];
  turnsByIndex: Map<number, SampledTurn>;
  forbidden: string[];
};

// Builds one persona card from a frozen source: whole turns in, items with quotes out, each quote
// checked inside its named turn, one regeneration, thin under 6.
export const buildCardTask: JobTask<"build_card"> = async (payload, context) => {
  const input = await readCardInput(context.db, payload);
  if (input === "stop") return;
  if (input.source === undefined || input.source.frozen_at === null) {
    await failCard(context.db, payload, {
      code: "source_not_frozen",
      promptVersion: currentVersion("dossier"),
    });
    return;
  }
  const eligible = eligibleTurns(input.turns, input.source.sensitive_opt_in);
  if (eligible.length === 0) {
    await failCard(context.db, payload, {
      code: "card_source_empty",
      promptVersion: currentVersion("dossier"),
    });
    return;
  }
  try {
    await buildAndWrite(context, payload, { source: input.source, eligible });
  } catch (error) {
    await handleBuildError(context, payload, error);
  }
};

// The turn of the sample a card call sees, from a turn row.
function toSampledTurn(turn: TurnRow): SampledTurn {
  return {
    id: turn.id,
    turnIndex: turn.turn_index,
    text: turn.text,
    normText: turn.norm_text,
    isSensitive: turn.sensitive_categories.length > 0,
  };
}

// The turns a card may use: no sensitive tag, or every tag opted in, the same rule as
// recall_corpus.
export function eligibleTurns<T extends { sensitive_categories: readonly string[] }>(
  turns: readonly T[],
  optIn: readonly string[],
): T[] {
  return turns.filter(
    (turn) =>
      turn.sensitive_categories.length === 0 ||
      turn.sensitive_categories.every((category) => optIn.includes(category)),
  );
}

// Reads the card, its source and its turns in one transaction; a card that is not building is left
// alone and makes no call.
async function readCardInput(
  db: Kysely<Database>,
  payload: JobPayload<"build_card">,
): Promise<CardInput> {
  return withPerson(db, payload.personId, async (trx) => {
    const card = await trx
      .selectFrom("cards")
      .select(["id", "source_id", "state"])
      .where("id", "=", payload.cardId)
      .executeTakeFirst();
    if (card === undefined)
      throw new ContractError(
        "card_missing",
        "The card is not visible to this job. Graphile retries once; a deleted card stays missing.",
        500,
      );
    if (card.state !== "building") return "stop";
    const source = await trx
      .selectFrom("sources")
      .select(["id", "frozen_at", "sensitive_opt_in", "chars_per_token"])
      .where("id", "=", card.source_id)
      .executeTakeFirst();
    const turns = await trx
      .selectFrom("turns")
      .select(["id", "turn_index", "text", "norm_text", "sensitive_categories"])
      .where("source_id", "=", card.source_id)
      .orderBy("turn_index", "asc")
      .execute();
    return { source, turns };
  });
}

// Runs the card calls for one built sample and writes the card; a first reply that fails its schema
// fails the card, an error of the first call reaches the caller, and a regeneration that fails
// leaves the first reply's verified items.
async function buildAndWrite(
  context: JobContext,
  payload: JobPayload<"build_card">,
  input: { source: SourceRow; eligible: TurnRow[] },
): Promise<void> {
  const { source, eligible } = input;
  const sampled = sampleTurns(eligible.map(toSampledTurn), CARD_INPUT_MAX_CHARS);
  const first = cardCall(sampled);
  const plan: BuildPlan = {
    first,
    sampled,
    turnsByIndex: new Map(sampled.map((turn) => [turn.turnIndex, turn])),
    forbidden: [first.messages[0]?.content ?? ""],
  };
  const reply1 = await context.llm.complete({
    ...first,
    ledger: { personId: payload.personId, meetingId: null },
  });
  const parsed1 = CardBuildOutput.safeParse(reply1.parsed);
  if (!parsed1.success) {
    await failCard(context.db, payload, {
      code: "card_output_invalid",
      promptVersion: currentVersion("dossier"),
    });
    return;
  }
  const checks1 = verifyItems(parsed1.data.items, plan.turnsByIndex, plan.forbidden);
  const checks2 = await regenerate(context, payload, {
    plan,
    replyText: reply1.text ?? "",
    failures: checks1.filter((check): check is FailedItem => !check.ok),
  });
  const final = mergeVerified(checks1, checks2);
  const charsPerToken =
    source.chars_per_token === null
      ? charsPerTokenFrom(
          requestChars(
            buildChatRequest({
              callSite: "card",
              messages: first.messages,
              schema: first.schema,
              stream: false,
            }),
          ),
          reply1.usage.promptTokens,
        )
      : null;
  await writeCard(context, payload, {
    itemsTotal: parsed1.data.items.length,
    final,
    isThin: final.length < CARD_ITEMS_MIN,
    charsPerToken,
    sourceId: source.id,
    promptVersion: first.promptVersion,
  });
}

// The one regeneration: when a check failed and the card call allows a retry, the failed items go
// back once; a second failure is dropped. A regeneration that throws is logged and gives nothing,
// so the card keeps the first reply's verified items instead of failing.
async function regenerate(
  context: JobContext,
  payload: JobPayload<"build_card">,
  args: { plan: BuildPlan; replyText: string; failures: FailedItem[] },
): Promise<ItemCheck[]> {
  if (args.failures.length === 0 || CALL_SITE_CONFIG.card.retries < 1) return [];
  try {
    const regeneration = cardRegenerationCall(args.plan.first, args.replyText, args.failures);
    const reply2 = await context.llm.complete({
      ...regeneration,
      ledger: { personId: payload.personId, meetingId: null },
    });
    const parsed2 = CardBuildOutput.safeParse(reply2.parsed);
    return parsed2.success
      ? verifyItems(parsed2.data.items, args.plan.turnsByIndex, args.plan.forbidden)
      : [];
  } catch (error) {
    context.log.warn(
      { cardId: payload.cardId, code: "card_regeneration_failed", reason: cardErrorCode(error) },
      "build_card: the regeneration failed, so the card keeps the first reply's verified items",
    );
    return [];
  }
}

// The chars per token of a source from its first card call: request characters over prompt tokens,
// 3 decimals, at most 999.999; null when the reply reported no prompt tokens.
export function charsPerTokenFrom(requestCharCount: number, promptTokens: number): number | null {
  if (promptTokens <= 0) return null;
  return Math.min(999.999, Math.round((requestCharCount / promptTokens) * 1000) / 1000);
}

// The error code stored on a failed card: the ContractError code, else card_build_error.
export function cardErrorCode(error: unknown): string {
  return error instanceof ContractError ? error.code : "card_build_error";
}

// Marks the card failed with its code, but only while it is still building.
async function failCard(
  db: Kysely<Database>,
  payload: JobPayload<"build_card">,
  failure: { code: string; promptVersion: string },
): Promise<void> {
  await withPerson(db, payload.personId, (trx) =>
    trx
      .updateTable("cards")
      .set({
        state: "failed",
        error: failure.code,
        model: CHAT_MODEL,
        prompt_version: failure.promptVersion,
      })
      .where("id", "=", payload.cardId)
      .where("state", "=", "building")
      .execute(),
  );
}

// Writes the card and its items in one transaction, and the calibrated chars per token of the
// source.
async function writeCard(
  context: JobContext,
  payload: JobPayload<"build_card">,
  result: CardResult,
): Promise<void> {
  await withPerson(context.db, payload.personId, async (trx) => {
    const built = await trx
      .updateTable("cards")
      .set({
        state: result.isThin ? "thin" : "ready",
        thin: result.isThin,
        items_total: result.itemsTotal,
        items_verified: result.final.length,
        built_at: context.now(),
        model: CHAT_MODEL,
        prompt_version: result.promptVersion,
        error: null,
      })
      .where("id", "=", payload.cardId)
      .where("state", "=", "building")
      .returning("id")
      .executeTakeFirst();
    if (built === undefined) return;
    if (result.final.length > 0) {
      await trx
        .insertInto("card_items")
        .values(
          result.final.map((check, index) => ({
            card_id: payload.cardId,
            person_id: payload.personId,
            position: index + 1,
            kind: check.item.kind,
            claim: check.item.claim,
            lang: check.item.lang,
            gloss: check.item.gloss,
            turn_id: check.turn.id,
            quote: check.item.quote,
            norm_quote: check.normQuote,
            verified: true,
            flagged: false,
            sensitive: check.turn.isSensitive,
          })),
        )
        .execute();
    }
    if (result.charsPerToken !== null) {
      await trx
        .updateTable("sources")
        .set({ chars_per_token: result.charsPerToken })
        .where("id", "=", result.sourceId)
        .where("chars_per_token", "is", null)
        .execute();
    }
  });
}

// Handles an error of the build: a full window is rethrown for the wrapper, a cap or any other
// error fails the card.
async function handleBuildError(
  context: JobContext,
  payload: JobPayload<"build_card">,
  error: unknown,
): Promise<void> {
  if (error instanceof LimiterBusy) throw error;
  if (error instanceof CapReached) {
    await failCard(context.db, payload, {
      code: error.code,
      promptVersion: currentVersion("dossier"),
    });
    return;
  }
  const code = cardErrorCode(error);
  context.log.error({ cardId: payload.cardId, code }, "build_card: failed");
  await failCard(context.db, payload, { code, promptVersion: currentVersion("dossier") });
}
