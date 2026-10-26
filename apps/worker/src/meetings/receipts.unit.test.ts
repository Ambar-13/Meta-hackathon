import { expect, it } from "vitest";
import { normQuote } from "@meet-first/receipts";
import type { ChatMessage } from "@meet-first/llm";
import {
  buildReceiptsMessages,
  checkClaims,
  parseTurnLabel,
  runReceipts,
  type CitableTurn,
  type ReceiptsCallFn,
} from "./receipts.js";

// One citable turn of the speaking side, with its normalised text as the check reads it.
function turn(index: number, text: string): CitableTurn {
  return { turnId: "turn-" + String(index), turnIndex: index, text, normText: normQuote(text) };
}

// The turns a receipts check may cite, by turn index.
const turns = new Map<number, CitableTurn>([
  [14, turn(14, "If I'm going to miss a date I say so that morning, not after.")],
  [15, turn(15, "Each of us should own one area end to end.")],
  [20, turn(20, "सब फैसले लिख कर रखो ताकि बाद में कोई भ्रम न हो")],
  [30, turn(30, "We asked: how do we split money if one of us does more of the work this month?")],
]);

// The texts a quote may never repeat: the meeting question and a rules text.
const forbidden = ["How do we split money if one of us does more of the work this month?", "RULES TEXT"];

// One claim as the receipts reply holds it.
function claim(label: string, quote: string, extra: { lang?: string; gloss?: string } = {}) {
  return { text: "c", quote, turn_id: label, lang: extra.lang ?? "en", gloss: extra.gloss ?? "g" };
}

// The first messages of every receipts request in these tests.
const messages0: ChatMessage[] = buildReceiptsMessages("RECEIPTS RULES", { side: "a", speechText: "s", cardQuotes: [], recallTurns: [] });

// A fake receipts call: returns its scripted replies in order, records the messages of each call, and throws a scripted error when a reply is an Error.
function fakeReceipts(replies: ReadonlyArray<unknown>) {
  const queue = [...replies];
  const seen: ChatMessage[][] = [];
  const call: ReceiptsCallFn = (messages) => {
    seen.push(messages);
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { call, seen };
}

it("R6.2-T1: turn labels read as numbers in three forms and nothing else", () => {
  expect([parseTurnLabel("14"), parseTurnLabel("t:14"), parseTurnLabel("[t:14]"), parseTurnLabel(" 14 ")]).toEqual([14, 14, 14, 14]);
  expect([parseTurnLabel("t:x"), parseTurnLabel(""), parseTurnLabel("1e3"), parseTurnLabel("-3")]).toEqual([null, null, null, null]);
});

it("D26-T1: a claim is checked only inside the turn its label names", () => {
  const checked = checkClaims({ claims: [claim("14", "Each of us should own one area")] }, turns, forbidden);
  expect(checked?.length).toBe(1);
  expect(checked?.[0]?.failure).toBe("not_in_turn");
  expect(checked?.[0]?.turnId).toBe("turn-14");
});

it("R6.4-T1: a label outside the speaking side's turns is dropped and counted, using a fake receipts call", async () => {
  const replies = [{ claims: [claim("99", "Each of us should own one area end to end")] }, { claims: [claim("99", "Each of us should own one area end to end")] }];
  const receipts = fakeReceipts(replies);
  const result = await runReceipts({ messages: messages0, call: receipts.call, turns, forbidden });
  expect(result).toEqual({ claims: [], droppedCount: 1, callCount: 2 });
});

it("D27-T1: one failed claim causes exactly one regeneration whose reply is used, using a fake receipts call", async () => {
  const replies = [
    { claims: [claim("14", "I always tell people about missed dates")] },
    { claims: [claim("14", "if I'm going to miss a date I say so that morning")] },
  ];
  const receipts = fakeReceipts(replies);
  const result = await runReceipts({ messages: messages0, call: receipts.call, turns, forbidden });
  expect(result.callCount).toBe(2);
  expect(result.claims[0]?.isVerified).toBe(true);
  expect(result.claims[0]?.isRegenerated).toBe(true);
  expect(result.claims[0]?.turnId).toBe("turn-14");
  const second = receipts.seen[1] ?? [];
  expect(second.length).toBe(messages0.length + 2);
  expect(second[second.length - 1]?.content).toContain("- claim 1: the quote is not found in the turn it names");
});

it("D27-T2: when every claim passes, the receipts call runs once, using a fake receipts call", async () => {
  const receipts = fakeReceipts([{ claims: [claim("15", "Each of us should own one area end to end")] }]);
  const result = await runReceipts({ messages: messages0, call: receipts.call, turns, forbidden });
  expect(result.callCount).toBe(1);
  expect(result.claims[0]?.isVerified).toBe(true);
  expect(result.claims[0]?.isRegenerated).toBe(false);
});

it("R6.5-T1: a claim that fails twice is stored flagged, using a fake receipts call", async () => {
  const failing = { claims: [claim("14", "this sentence never appeared in any turn")] };
  const receipts = fakeReceipts([failing, failing]);
  const result = await runReceipts({ messages: messages0, call: receipts.call, turns, forbidden });
  expect(result.claims[0]?.isVerified).toBe(false);
  expect(result.claims[0]?.isRegenerated).toBe(true);
  expect(result.callCount).toBe(2);
});

it("R6.6-T1: a quote taken from the meeting question is refused", () => {
  const checked = checkClaims({ claims: [claim("30", "split money if one of us does more of the work")] }, turns, forbidden);
  expect(checked?.[0]?.failure).toBe("substring_of_prompt");
});

it("R6.3-T1: a Hindi quote keeps its language and its English gloss", async () => {
  const receipts = fakeReceipts([{ claims: [claim("20", "सब फैसले लिख कर रखो ताकि", { lang: "hi", gloss: "Wants decisions written down" })] }]);
  const result = await runReceipts({ messages: messages0, call: receipts.call, turns, forbidden });
  expect(result.claims[0]?.quote).toBe("सब फैसले लिख कर रखो ताकि");
  expect(result.claims[0]?.lang).toBe("hi");
  expect(result.claims[0]?.gloss).toBe("Wants decisions written down");
  expect(result.claims[0]?.isVerified).toBe(true);
});

it("R6.2-T2: a reply that breaks the schema is regenerated once with the schema line, using a fake receipts call", async () => {
  const receipts = fakeReceipts([{ foo: 1 }, { claims: [claim("15", "Each of us should own one area end to end")] }]);
  const result = await runReceipts({ messages: messages0, call: receipts.call, turns, forbidden });
  const second = receipts.seen[1] ?? [];
  expect(second[second.length - 1]?.content).toContain("- claim 1: the reply did not match the claims schema");
  expect(result.claims[0]?.isVerified).toBe(true);
  expect(result.callCount).toBe(2);
});
