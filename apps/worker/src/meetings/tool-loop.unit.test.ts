import { expect, it } from "vitest";
import { ContractError, type ToolDefinition } from "@meet-first/contracts";
import type { ChatMessage, ToolCall } from "@meet-first/llm";
import {
  NO_DECISION_REASON,
  PartialTextWriter,
  runSpeechRounds,
  type SpeakResult,
} from "./tool-loop.js";

// The clock's start in these tests, and a fake clock that the test moves by hand.
const T0 = new Date("2026-10-27T03:00:00.000Z");
function fakeClock(startMs: number) {
  let current = startMs;
  return {
    now: () => new Date(current),
    set: (ms: number) => {
      current = ms;
    },
  };
}

// The system prefix and the user message that open every speech request.
const sys: ChatMessage = { role: "system", content: "p" };
const usr: ChatMessage = { role: "user", content: "v" };

// A recall tool call with a fixed id, as the model sends it.
function recall(n: number): ToolCall {
  return {
    id: "call_" + String(n),
    type: "function",
    function: { name: "recall", arguments: '{"query":"deadlines"}' },
  };
}

// One request the fake speak function recorded.
type Recorded = { messages: ChatMessage[]; tools: ToolDefinition[] | undefined; round: number };

// The element at index; throws when it is missing, so a check never passes on an absent request.
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("No element at index " + String(index) + ".");
  return item;
}

// A fake speak function: returns its scripted results in order, or throws a scripted error, and
// records each request.
function fakeSpeak(script: ReadonlyArray<SpeakResult | Error>) {
  const queue = [...script];
  const requests: Recorded[] = [];
  const speak = (request: Recorded): Promise<SpeakResult> => {
    requests.push({ messages: [...request.messages], tools: request.tools, round: request.round });
    const next = queue.shift();
    if (next === undefined)
      return Promise.reject(new Error("The fake speak function has no reply left."));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { speak, requests };
}

// A fake round function: answers each tool call of the assistant message with a plain result, and
// counts its calls.
function fakeRound() {
  let calls = 0;
  const runRound = (round: { assistant: { tool_calls?: ToolCall[] | undefined } }) => {
    calls += 1;
    const toolMessages = (round.assistant.tool_calls ?? []).map((call) => ({
      role: "tool" as const,
      tool_call_id: call.id,
      content: "r",
    }));
    return Promise.resolve({ toolMessages, isDecision: false });
  };
  return { runRound, count: () => calls };
}

// A fake discard function: counts the discards it is asked for.
function fakeDiscard() {
  let count = 0;
  return {
    discardRound: () => {
      count += 1;
      return Promise.resolve();
    },
    count: () => count,
  };
}

it("R5.7-T1: six scripted recalls produce exactly 5 requests, using a fake speak function", async () => {
  const replies: Array<SpeakResult> = [1, 2, 3, 4].map((n) => ({
    text: "",
    toolCalls: [recall(n)],
    finishReason: "tool_calls",
  }));
  replies.push({ text: "Here is my turn.", toolCalls: [recall(5)], finishReason: "tool_calls" });
  const speaker = fakeSpeak([
    ...replies,
    { text: "Here is my turn.", toolCalls: [recall(5)], finishReason: "tool_calls" },
  ]);
  const round = fakeRound();
  const discard = fakeDiscard();
  const outcome = await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: round.runRound,
      discardRound: discard.discardRound,
    },
  );
  expect(speaker.requests.length).toBe(5);
  expect(round.count()).toBe(4);
  expect(outcome).toEqual({ text: "Here is my turn.", requestsMade: 5, hasDecision: false });
});

it("D37-T1: requests 1 to 4 offer tools and request 5 has no tools field, using a fake speak function", async () => {
  const replies: SpeakResult[] = [1, 2, 3, 4].map((n) => ({
    text: "",
    toolCalls: [recall(n)],
    finishReason: "tool_calls",
  }));
  replies.push({ text: "Here is my turn.", toolCalls: [], finishReason: "stop" });
  const speaker = fakeSpeak(replies);
  const round = fakeRound();
  const discard = fakeDiscard();
  await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: round.runRound,
      discardRound: discard.discardRound,
    },
  );
  for (const request of speaker.requests.slice(0, 4)) {
    expect(request.tools?.map((tool) => tool.function.name)).toEqual(["recall"]);
  }
  expect(at(speaker.requests, 4).tools).toBeUndefined();
});

it("D43-T1: an empty reply becomes the fixed sentence, using a fake speak function", async () => {
  const speaker = fakeSpeak([{ text: "", toolCalls: [], finishReason: "stop" }]);
  const round = fakeRound();
  const discard = fakeDiscard();
  const outcome = await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: round.runRound,
      discardRound: discard.discardRound,
    },
  );
  expect(outcome).toEqual({
    text: "I'd rather my human speak to this",
    requestsMade: 1,
    hasDecision: false,
  });
  expect(round.count()).toBe(0);
});

it("D43-T2: an empty reply in the decide phase also becomes the fixed sentence, using a fake speak function", async () => {
  const speaker = fakeSpeak([{ text: "", toolCalls: [], finishReason: "stop" }]);
  const round = fakeRound();
  const discard = fakeDiscard();
  const outcome = await runSpeechRounds(
    { phase: "decide", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: round.runRound,
      discardRound: discard.discardRound,
    },
  );
  expect(speaker.requests[0]?.tools?.map((tool) => tool.function.name)).toEqual([
    "concede",
    "hold",
  ]);
  expect(outcome.text).toBe("I'd rather my human speak to this");
  expect(round.count()).toBe(0);
});

it("D42-T3: a decide turn with no concede or hold call reports no decision, using a fake speak function", async () => {
  const speaker = fakeSpeak([
    { text: "My human keeps the position.", toolCalls: [], finishReason: "stop" },
  ]);
  const round = fakeRound();
  const discard = fakeDiscard();
  const outcome = await runSpeechRounds(
    { phase: "decide", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: round.runRound,
      discardRound: discard.discardRound,
    },
  );
  expect(speaker.requests[0]?.tools?.map((tool) => tool.function.name)).toEqual([
    "concede",
    "hold",
  ]);
  expect(outcome).toEqual({
    text: "My human keeps the position.",
    hasDecision: false,
    requestsMade: 1,
  });
  expect(NO_DECISION_REASON).toBe("no explicit decision");
});

it("D37-T2: tool calls in the reply to the 5th request, which had no tools, are read as text, using a fake speak function", async () => {
  const speaker = fakeSpeak([
    { text: "Final words.", toolCalls: [recall(9)], finishReason: "tool_calls" },
  ]);
  const round = fakeRound();
  const discard = fakeDiscard();
  const outcome = await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 4, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: round.runRound,
      discardRound: discard.discardRound,
    },
  );
  expect(at(speaker.requests, 0).tools).toBeUndefined();
  expect(outcome).toEqual({ text: "Final words.", requestsMade: 5, hasDecision: false });
  expect(round.count()).toBe(0);
});

it("R10.7-T1: a cut round is discarded and retried once and a second cut fails, using a fake speak function", async () => {
  const cut = () => new ContractError("model_stream_cut", "cut", 502);
  const once = fakeSpeak([cut(), { text: "Done talking.", toolCalls: [], finishReason: "stop" }]);
  const onceDiscard = fakeDiscard();
  const onceOutcome = await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: once.speak,
      runRound: fakeRound().runRound,
      discardRound: onceDiscard.discardRound,
    },
  );
  expect(onceDiscard.count()).toBe(1);
  expect(once.requests.length).toBe(2);
  expect(at(once.requests, 0).messages).toEqual(at(once.requests, 1).messages);
  expect(onceOutcome.text).toBe("Done talking.");

  const twice = fakeSpeak([cut(), cut()]);
  const twiceDiscard = fakeDiscard();
  const failure = await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: twice.speak,
      runRound: fakeRound().runRound,
      discardRound: twiceDiscard.discardRound,
    },
  ).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ContractError);
  expect((failure as ContractError).code).toBe("model_stream_cut");
  expect(twiceDiscard.count()).toBe(1);
});

it("R10.3-T1: a first-token timeout after the client's retry fails the turn, using a fake speak function", async () => {
  const speaker = fakeSpeak([new ContractError("model_first_token_timeout", "late", 504)]);
  const discard = fakeDiscard();
  const failure = await runSpeechRounds(
    { phase: "explore", messages: [sys, usr], requestsMade: 0, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: fakeRound().runRound,
      discardRound: discard.discardRound,
    },
  ).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(ContractError);
  expect((failure as ContractError).code).toBe("model_first_token_timeout");
  expect(discard.count()).toBe(0);
});

it("W3-SPEECH-T1 (D47): a round that called a tool is left out of the turn text, using a fake speak function", async () => {
  const messages: ChatMessage[] = [
    sys,
    usr,
    { role: "assistant", content: "Let me look.", tool_calls: [recall(7)] },
    { role: "tool", tool_call_id: "call_7", content: "x" },
  ];
  const speaker = fakeSpeak([{ text: "Going on.", toolCalls: [], finishReason: "stop" }]);
  const outcome = await runSpeechRounds(
    { phase: "explore", messages, requestsMade: 1, hasDecision: false },
    {
      speak: speaker.speak,
      runRound: fakeRound().runRound,
      discardRound: fakeDiscard().discardRound,
    },
  );
  expect(outcome).toEqual({ text: "Going on.", requestsMade: 2, hasDecision: false });
});

it("D47-T1: the partial text writer writes at most every 250 ms and on flush, using a fake clock", async () => {
  const clock = fakeClock(T0.getTime());
  const written: string[] = [];
  const writer = new PartialTextWriter(
    {
      write: (text) => {
        written.push(text);
        return Promise.resolve();
      },
      now: () => clock.now(),
    },
    "",
    T0,
  );
  clock.set(T0.getTime());
  await writer.append("a");
  clock.set(T0.getTime() + 100);
  await writer.append("b");
  clock.set(T0.getTime() + 260);
  await writer.append("c");
  await writer.flush();
  writer.endRound();
  clock.set(T0.getTime() + 300);
  await writer.append("d");
  await writer.flush();
  expect(written).toEqual(["abc", "abc\n\nd"]);
});
