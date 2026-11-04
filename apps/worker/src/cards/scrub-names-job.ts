import { ContractError, NamesPassOutput, type JobPayload } from "@meet-first/contracts";
import { withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import { normQuote } from "@meet-first/receipts";
import { makePlaceholderCounter } from "@meet-first/scrub";
import { CapReached, startOfUtcDay } from "@meet-first/llm";
import type { Kysely } from "kysely";
import type { JobContext, JobTask } from "../job-context.js";
import {
  assignTokens,
  isAllowlisted,
  planTurnRewrites,
  type NameToken,
  type TurnRewrite,
} from "./apply-role-tokens.js";
import { chunkTurnsForNames, namesPassCall } from "./name-chunks.js";

// One names pass as the job found it in the database: the source, its pass row, the person, and the
// turns.
type NamesInput = {
  source: { id: string; frozen_at: Date | null } | undefined;
  pass: { source_id: string } | undefined;
  person: { display_name: string; affiliations: string[] } | undefined;
  turns: Array<{ id: string; turn_index: number; text: string; sensitive_categories: string[] }>;
};
// One name the model returned: its text and its role.
type FoundName = { text: string; role: string };
// The rows a names pass writes: the turn rewrites and the name tokens found for them.
type NamesPlan = { rewrites: TurnRewrite[]; tokens: NameToken[] };

// When a names pass that the daily cap stopped runs again: one minute after the next UTC midnight.
export function namesPassRetryAt(now: Date): Date {
  return new Date(startOfUtcDay(now).getTime() + 86_400_000 + 60_000);
}

// The names pass for one uploaded source: other people's names become role tokens, and the names
// review gets one row per name.
export const scrubNamesTask: JobTask<"scrub_names"> = async (payload, context) => {
  const input = await readNamesInput(context.db, payload);
  if (input.source === undefined || input.person === undefined) {
    throw new ContractError(
      "names_source_missing",
      "The source or its person is not visible to this job. Graphile retries once; a deleted source stays missing.",
      500,
    );
  }
  if (input.source.frozen_at !== null) {
    context.log.info({ sourceId: payload.sourceId }, "scrub_names: source already frozen");
    return;
  }
  if (input.pass !== undefined) {
    context.log.info({ sourceId: payload.sourceId }, "scrub_names: names pass already ran");
    return;
  }
  const found = await findNamesOrStop(context, payload, input);
  if (found === undefined) return;
  const tokens = assignTokens(
    found.filter(
      (name) =>
        !isAllowlisted(name.text, {
          displayName: input.person?.display_name ?? "",
          affiliations: input.person?.affiliations ?? [],
        }),
    ),
  );
  const rewrites = planTurnRewrites(input.turns, tokens);
  const written = await writeNamesPass(context, payload, { rewrites, tokens });
  if (written)
    context.log.info(
      { sourceId: payload.sourceId, names: written.names, rows: written.rows },
      "scrub_names: done",
    );
};

// Reads the source, its pass row, the person and the turns in one transaction; the transaction ends
// before any model call.
async function readNamesInput(
  db: Kysely<Database>,
  payload: JobPayload<"scrub_names">,
): Promise<NamesInput> {
  return withPerson(db, payload.personId, async (trx) => {
    const source = await trx
      .selectFrom("sources")
      .select(["id", "frozen_at"])
      .where("id", "=", payload.sourceId)
      .executeTakeFirst();
    const pass = await trx
      .selectFrom("names_passes")
      .select("source_id")
      .where("source_id", "=", payload.sourceId)
      .executeTakeFirst();
    const person = await trx
      .selectFrom("people")
      .select(["display_name", "affiliations"])
      .where("id", "=", payload.personId)
      .executeTakeFirst();
    const turns = await trx
      .selectFrom("turns")
      .select(["id", "turn_index", "text", "sensitive_categories"])
      .where("source_id", "=", payload.sourceId)
      .orderBy("turn_index", "asc")
      .execute();
    return { source, pass, person, turns };
  });
}

// Finds the names in every chunk, one call per chunk with no transaction open. A cap stops the pass
// here and is handled.
async function findNamesOrStop(
  context: JobContext,
  payload: JobPayload<"scrub_names">,
  input: NamesInput,
): Promise<FoundName[] | undefined> {
  try {
    return await findNames(context, payload, input);
  } catch (error) {
    if (!(error instanceof CapReached)) throw error;
    if (error.code === "daily_cap_reached") {
      await context.enqueue("scrub_names", payload, { runAt: namesPassRetryAt(context.now()) });
      context.log.warn(
        { sourceId: payload.sourceId },
        "scrub_names: daily cap reached, runs again after midnight UTC",
      );
    } else {
      context.log.error({ sourceId: payload.sourceId }, "scrub_names: total cap reached");
    }
    return undefined;
  }
}

// The names of every chunk, in chunk order and then reply order.
async function findNames(
  context: JobContext,
  payload: JobPayload<"scrub_names">,
  input: NamesInput,
): Promise<FoundName[]> {
  const person = input.person;
  const allowlist = [person?.display_name ?? "", ...(person?.affiliations ?? [])].map((entry) =>
    entry.replace(/\s+/g, " ").trim(),
  );
  const chunks = chunkTurnsForNames(
    input.turns.map((turn) => ({ turnIndex: turn.turn_index, text: turn.text })),
  );
  const names: FoundName[] = [];
  for (const chunk of chunks) {
    const call = namesPassCall({ allowlist, chunkText: chunk.text });
    const reply = await context.llm.complete({
      ...call,
      ledger: { personId: payload.personId, meetingId: null },
    });
    const parsed = NamesPassOutput.safeParse(reply.parsed);
    if (!parsed.success)
      throw new ContractError(
        "names_output_invalid",
        "The names pass reply does not match its schema. Graphile retries the job once.",
        502,
      );
    names.push(...parsed.data.names);
  }
  return names;
}

// Writes the whole names pass in one transaction, guarded against a source that changed meanwhile;
// returns the counts, or undefined when nothing was written.
async function writeNamesPass(
  context: JobContext,
  payload: JobPayload<"scrub_names">,
  plan: NamesPlan,
): Promise<{ names: number; rows: number } | undefined> {
  return withPerson(context.db, payload.personId, async (trx) => {
    const source = await trx
      .selectFrom("sources")
      .select("frozen_at")
      .where("id", "=", payload.sourceId)
      .forUpdate()
      .executeTakeFirst();
    const done = await trx
      .selectFrom("names_passes")
      .select("source_id")
      .where("source_id", "=", payload.sourceId)
      .executeTakeFirst();
    if (source === undefined || source.frozen_at !== null || done !== undefined) {
      context.log.info(
        { sourceId: payload.sourceId },
        "scrub_names: the source changed during the pass",
      );
      return undefined;
    }
    const nextId = await placeholderCounterFor(trx, payload.sourceId);
    await writeTurnRewrites(trx, plan.rewrites);
    const idsByToken = await writeRedactions(trx, { payload, plan, nextId });
    const names = await writeNameRows(trx, { payload, plan, idsByToken });
    await trx
      .insertInto("names_passes")
      .values({ source_id: payload.sourceId, person_id: payload.personId })
      .execute();
    return { names, rows: idsByToken.reduce((sum, ids) => sum + ids.length, 0) };
  });
}

// The next placeholder id after the source's highest, so new ids continue the source's counter.
async function placeholderCounterFor(
  trx: DatabaseTransaction,
  sourceId: string,
): Promise<() => string> {
  const ids = await trx
    .selectFrom("redactions")
    .select("placeholder_id")
    .where("source_id", "=", sourceId)
    .execute();
  const highest = ids.reduce(
    (max, row) => Math.max(max, Number.parseInt(row.placeholder_id, 16)),
    0,
  );
  return makePlaceholderCounter(highest + 1);
}

// Writes the new text and the new tags of every turn the pass changed (turns of an unfrozen source
// may change).
async function writeTurnRewrites(
  trx: DatabaseTransaction,
  rewrites: readonly TurnRewrite[],
): Promise<void> {
  for (const rewrite of rewrites) {
    if (rewrite.isTextChanged) {
      await trx
        .updateTable("turns")
        .set({
          text: rewrite.text,
          norm_text: normQuote(rewrite.text),
          sensitive_categories: rewrite.categories,
        })
        .where("id", "=", rewrite.turnId)
        .execute();
    } else if (rewrite.isCategoriesChanged) {
      await trx
        .updateTable("turns")
        .set({ sensitive_categories: rewrite.categories })
        .where("id", "=", rewrite.turnId)
        .execute();
    }
  }
}

// Writes one redaction row for each occurrence the pass wrote, in turn order and then name order;
// returns the ids of each name.
async function writeRedactions(
  trx: DatabaseTransaction,
  args: { payload: JobPayload<"scrub_names">; plan: NamesPlan; nextId: () => string },
): Promise<string[][]> {
  const idsByToken: string[][] = args.plan.tokens.map(() => []);
  const rows: Array<{
    source_id: string;
    turn_id: string;
    person_id: string;
    category: string;
    placeholder_id: string;
  }> = [];
  for (const rewrite of args.plan.rewrites) {
    rewrite.occurrences.forEach((count, tokenIndex) => {
      for (let occurrence = 0; occurrence < count; occurrence += 1) {
        const placeholderId = args.nextId();
        idsByToken[tokenIndex]?.push(placeholderId);
        rows.push({
          source_id: args.payload.sourceId,
          turn_id: rewrite.turnId,
          person_id: args.payload.personId,
          category: "person",
          placeholder_id: placeholderId,
        });
      }
    });
  }
  for (let start = 0; start < rows.length; start += 1000) {
    await trx
      .insertInto("redactions")
      .values(rows.slice(start, start + 1000))
      .execute();
  }
  return idsByToken;
}

// Writes one source_names row for each name that occurs in a turn, in token order.
async function writeNameRows(
  trx: DatabaseTransaction,
  args: { payload: JobPayload<"scrub_names">; plan: NamesPlan; idsByToken: string[][] },
): Promise<number> {
  const rows = args.plan.tokens.flatMap((token, index) => {
    const ids = args.idsByToken[index] ?? [];
    return ids.length === 0
      ? []
      : [
          {
            source_id: args.payload.sourceId,
            person_id: args.payload.personId,
            text: token.text,
            role_token: token.token,
            is_minor: token.isMinor,
            placeholder_ids: ids,
          },
        ];
  });
  if (rows.length > 0) await trx.insertInto("source_names").values(rows).execute();
  return rows.length;
}
