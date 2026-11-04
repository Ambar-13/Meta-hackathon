import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { RecordedCall } from "@meet-first/contracts";
import { requestChars, requestHash, type LlmRequest } from "@meet-first/llm";
import { normQuote } from "@meet-first/receipts";
import { hasEnoughOwnText } from "../cards/index.js";
import { englishItem, replyResponse } from "./fixture-cases.js";
import { recordedReplyPath } from "./recorded-replies.js";

// The one third-party name of A's paste, the golden path's FIXTURE_NAME.
export const GOLDEN_PATH_NAME = "Rohan Mehta";
// The phrase that marks a third-party name in B's export: "my" or "My", a relation word, then one or two capitalised words.
export const THIRD_PARTY_PATTERN =
  /\b[Mm]y (friend|colleague|manager|boss|sister|brother|partner|teammate|mentor) (\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)?)/gu;
// The kinds given to the golden path's card items, in order.
export const GOLDEN_PATH_KINDS = [
  "habit",
  "preference",
  "value",
  "boundary",
  "goal",
  "habit",
  "preference",
  "value",
] as const;
// The reply one golden path request gets by rule, or the reason no rule gives one.
export type GoldenPathReply =
  | {
      ok: true;
      response: Record<string, unknown>;
      usage: {
        promptTokens: number;
        cachedTokens: number;
        completionTokens: number;
        reasoningTokens: number;
      };
    }
  | { ok: false; reason: string };

const MESSAGES = z.array(
  z.object({ role: z.string(), content: z.string().nullable() }).passthrough(),
);

// The usage a rule-made reply reports: 4 characters per token for the prompt (an estimate) and the given completion tokens.
function usageFor(
  request: LlmRequest,
  completionTokens: number,
): {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
} {
  return {
    promptTokens: Math.ceil(requestChars(request.body) / 4),
    cachedTokens: 0,
    completionTokens,
    reasoningTokens: 0,
  };
}

// The names A and B get: A's one name by rule, or every marked name in the turns of B, each written once (golden path steps 2.5 and 4.3).
function namesFor(user: string): Array<{ text: string; role: string }> {
  const turnsText = user.slice(Math.max(0, user.indexOf("<source_turns>")));
  if (turnsText.includes(GOLDEN_PATH_NAME)) return [{ text: GOLDEN_PATH_NAME, role: "colleague" }];
  const found: Array<{ text: string; role: string }> = [];
  const taken = new Set<string>();
  for (const match of turnsText.matchAll(THIRD_PARTY_PATTERN)) {
    const text = match[2] ?? "";
    if (taken.has(text.toLowerCase())) continue;
    taken.add(text.toLowerCase());
    found.push({ text, role: match[1] ?? "" });
  }
  return found;
}

// The items a card gets by rule: the start of each turn's first line that is long enough and not in the prompt (golden path steps 3 and 4).
function cardItemsFor(system: string, user: string, request: LlmRequest): GoldenPathReply {
  const kept: Array<{ label: string; quote: string }> = [];
  const seen = new Set<string>();
  for (const match of user.matchAll(/\[t:(\d+)\] ([^\n]*)/g)) {
    const label = match[1] ?? "";
    if (seen.has(label)) continue;
    seen.add(label);
    const line = match[2] ?? "";
    const cut = line.length <= 80 ? line.length : Math.max(0, line.slice(0, 80).lastIndexOf(" "));
    const quote = line.slice(0, cut).replace(/[\s\p{P}]+$/u, "");
    if (
      quote.includes(" ") &&
      hasEnoughOwnText(quote) &&
      !normQuote(system).includes(normQuote(quote))
    )
      kept.push({ label, quote });
  }
  if (kept.length < 6)
    return {
      ok: false,
      reason: `only ${String(kept.length)} turns give a quote; a ready card needs 6`,
    };
  const items = kept
    .slice(0, 8)
    .map((entry, index) =>
      englishItem([
        GOLDEN_PATH_KINDS[index] ?? "habit",
        `Says: ${entry.quote}`.slice(0, 300),
        entry.label,
        entry.quote,
      ]),
    );
  return { ok: true, response: replyResponse({ items }), usage: usageFor(request, 1200) };
}

// The reply one golden path request gets by rule, or the reason no rule gives one.
export function goldenPathReply(request: LlmRequest): GoldenPathReply {
  const messages = MESSAGES.parse(request.body.messages);
  const system = messages[0]?.content ?? "";
  const user = messages[1]?.content ?? "";
  if (request.callSite === "scrub_names")
    return {
      ok: true,
      response: replyResponse({ names: namesFor(user) }),
      usage: usageFor(request, 20),
    };
  if (request.callSite === "card") return cardItemsFor(system, user, request);
  return { ok: false, reason: `no golden path rule for call site ${request.callSite}` };
}

// Writes a hand-written fixture for every miss file that has none yet; stops at the first request no rule answers.
export function writeGoldenPathFixtures(missRoot: string): {
  written: string[];
  stoppedAt: string | null;
} {
  const written: string[] = [];
  for (const callSite of ["scrub_names", "card"] as const) {
    const folder = join(missRoot, callSite);
    if (!existsSync(folder)) continue;
    for (const name of readdirSync(folder)
      .filter((file) => file.endsWith(".request.json"))
      .sort()) {
      const path = join(folder, name);
      const request = JSON.parse(readFileSync(path, "utf8")) as LlmRequest;
      const hash = requestHash(request.body);
      if (existsSync(recordedReplyPath(request.callSite, hash))) continue;
      const reply = goldenPathReply(request);
      if (!reply.ok) return { written, stoppedAt: `${path}: ${reply.reason}` };
      const call = RecordedCall.parse({
        callSite: request.callSite,
        promptVersion: request.promptVersion,
        requestHash: hash,
        request,
        response: reply.response,
        usage: reply.usage,
        recordedAt: null,
        handWritten: true,
      });
      const target = recordedReplyPath(request.callSite, hash);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(call, null, 2)}\n`);
      written.push(target);
    }
  }
  return { written, stoppedAt: null };
}

// The command line: `golden-fixture clear` empties the miss folder, `golden-fixture write` writes the fixtures the rules answer.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = join(tmpdir(), "meet-first-replay-misses");
  const command = process.argv[2];
  if (command === "clear") {
    rmSync(root, { recursive: true, force: true });
    console.log("golden-fixture: miss folder cleared");
  } else if (command === "write") {
    const result = writeGoldenPathFixtures(root);
    for (const path of result.written) console.log(path);
    if (result.stoppedAt !== null) {
      console.log(`golden-fixture: stopped at ${result.stoppedAt}`);
      process.exitCode = 1;
    } else {
      console.log(`golden-fixture: ${String(result.written.length)} fixtures written`);
    }
  } else {
    console.log("golden-fixture: use clear or write");
    process.exitCode = 2;
  }
}
