// The check_summary job: replaces the names of other people in a person's pasted summary, reads its points, and looks each point's
// quotes up in the person's own names-checked messages. One names call per run, since a summary fits one chunk. A summary saved again
// while the job runs is left to the job that save queued.
import type { Kysely } from "kysely";
import { NamesPassOutput, SUMMARY_MAX_CHARS, type SummaryPointView } from "@meet-first/contracts";
import { withPerson, type Database } from "@meet-first/db";
import { CapReached, LimiterBusy } from "@meet-first/llm";
import { parseSummary } from "@meet-first/parsers";
import { applyRoleTokens, assignTokens, isAllowlisted, namesPassCall, namesPassRetryAt, PROTECTED_TOKEN } from "../cards/index.js";
import type { JobContext, JobTask } from "../job-context.js";
import { findQuoteTurns } from "./find-quotes.js";

// What the job reads before its model call: the summary's text and the person's own names.
type SummaryInput = { text: string; displayName: string; affiliations: string[] };
// How the names call ended: the names found, or why there are none.
type NamesOutcome = { names: Array<{ text: string; role: string }> } | "failed" | "capped";

// The summary and the person, read as the person; undefined when there is no summary to check.
async function readSummaryInput(db: Kysely<Database>, personId: string): Promise<SummaryInput | undefined> {
  return withPerson(db, personId, async (trx) => {
    const summary = await trx.selectFrom("person_summaries").select("text").where("person_id", "=", personId).where("state", "=", "checking").executeTakeFirst();
    const person = await trx.selectFrom("people").select(["display_name", "affiliations"]).where("id", "=", personId).executeTakeFirst();
    if (summary === undefined || person === undefined) return undefined;
    return { text: summary.text, displayName: person.display_name, affiliations: person.affiliations };
  });
}

// The summary as the names prompt expects its messages: each block of fields on its own, after its label [t:N], with a blank line
// between blocks. The names come back as text, so the labels never reach the stored summary.
function labelledBlocks(text: string): string {
  const blocks = text.split(/\n\s*\n/u).map((block) => block.trim()).filter((block) => block !== "");
  return blocks.map((block, index) => `[t:${String(index)}] ${block}`).join("\n\n");
}

// The names in the summary, from one names call. A full token window is thrown on, so the job runs again in 5 s, as every job does; a
// daily cap runs the job again after midnight UTC; any other failure, after the client's own retry, ends as failed.
async function findSummaryNames(context: JobContext, personId: string, input: SummaryInput): Promise<NamesOutcome> {
  const allowlist = [input.displayName, ...input.affiliations].map((entry) => entry.replace(/\s+/g, " ").trim());
  try {
    const reply = await context.llm.complete({ ...namesPassCall({ allowlist, chunkText: labelledBlocks(input.text) }), ledger: { personId, meetingId: null } });
    const parsed = NamesPassOutput.safeParse(reply.parsed);
    return parsed.success ? { names: parsed.data.names } : "failed";
  } catch (error) {
    if (error instanceof LimiterBusy) throw error;
    if (error instanceof CapReached && error.code === "daily_cap_reached") {
      await context.enqueue("check_summary", { personId }, { runAt: namesPassRetryAt(context.now()) });
      return "capped";
    }
    context.log.warn({ personId, error: error instanceof Error ? error.message : String(error) }, "check_summary: names call failed");
    return "failed";
  }
}

// The rewritten summary cut back to SUMMARY_MAX_CHARS, since role tokens are longer than the names they replace: at the last blank line
// between blocks when there is one, else before any token the limit would split, and never inside a character.
export function fitSummaryLength(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text;
  const blank = text.slice(0, SUMMARY_MAX_CHARS).lastIndexOf("\n\n");
  if (blank > 0) return text.slice(0, blank).trimEnd();
  let end = SUMMARY_MAX_CHARS;
  const straddling = [...text.matchAll(PROTECTED_TOKEN)].find((match) => match.index < end && match.index + match[0].length > end);
  if (straddling !== undefined) end = straddling.index;
  const lastUnit = text.charCodeAt(end - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

// The checked points: each point with the first of its quotes found in the person's own messages, or null.
async function checkedPoints(db: Kysely<Database>, personId: string, text: string): Promise<SummaryPointView[]> {
  const points = parseSummary(text);
  return withPerson(db, personId, async (trx) => {
    const checked: SummaryPointView[] = [];
    for (const point of points) {
      const found = (await findQuoteTurns(trx, personId, point.quotes)).find((entry) => entry !== null) ?? null;
      checked.push({ ...point, found });
    }
    return checked;
  });
}

// Stores the result unless the summary was saved again meanwhile: ready with the new text and points, or failed with none.
async function storeResult(db: Kysely<Database>, personId: string, result: { readText: string; text: string; points: SummaryPointView[] } | { readText: string; isFailed: true }): Promise<void> {
  await withPerson(db, personId, async (trx) => {
    const set = "isFailed" in result
      ? { state: "failed" as const, points: JSON.stringify([]) }
      : { state: "ready" as const, text: result.text, points: JSON.stringify(result.points) };
    await trx.updateTable("person_summaries").set({ ...set, updated_at: new Date() })
      .where("person_id", "=", personId).where("text", "=", result.readText).where("state", "=", "checking").execute();
  });
}

// The task: names, points, quotes, then one write.
export const checkSummaryTask: JobTask<"check_summary"> = async (payload, context) => {
  const input = await readSummaryInput(context.db, payload.personId);
  if (input === undefined) {
    context.log.info({ personId: payload.personId }, "check_summary: no summary waiting to be checked");
    return;
  }
  const outcome = await findSummaryNames(context, payload.personId, input);
  if (outcome === "capped") return;
  if (outcome === "failed") {
    await storeResult(context.db, payload.personId, { readText: input.text, isFailed: true });
    return;
  }
  const person = { displayName: input.displayName, affiliations: input.affiliations };
  const tokens = assignTokens(outcome.names.filter((name) => !isAllowlisted(name.text, person)));
  const text = fitSummaryLength(applyRoleTokens(input.text, tokens));
  const points = await checkedPoints(context.db, payload.personId, text);
  await storeResult(context.db, payload.personId, { readText: input.text, text, points });
};
