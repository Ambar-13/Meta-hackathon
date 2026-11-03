import { describe, expect, it } from "vitest";
import type { OrchestratorFriends, OrchestratorPlanOutput } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import { checkPlan, NO_FRIENDS_SENTENCE, NO_QUESTION_SENTENCE, planUserText, RECENT_CHARS_MAX, RECENT_MESSAGE_MAX_CHARS, RECENT_MESSAGES_MAX, type RecentMessage } from "./plan-requests.js";

// Two friends: Mira Shah, who lets friends ask, and Jonah, who does not.
const FRIENDS: OrchestratorFriends = [
  { pairId: "00000000-0000-4000-8000-000000000001", displayName: "Mira Shah", canAsk: true },
  { pairId: "00000000-0000-4000-8000-000000000002", displayName: "Jonah", canAsk: false },
];
// A react plan about Mira with a question that fits an ask.
const REACT_PLAN: OrchestratorPlanOutput = { action: "react", friend: "Mira Shah", question: "How would you probably react if I moved our trip to March?", reply: "I can ask Mira's agent." };

describe("checkPlan", () => {
  it("W7-PLAN-T1: a react plan naming a friend whose switch is on is planned with that friend's pair and stored name", () => {
    expect(checkPlan(REACT_PLAN, FRIENDS)).toEqual({ state: "planned", action: "react", text: "I can ask Mira's agent.", question: REACT_PLAN.question, friendName: "Mira Shah", pairId: FRIENDS[0]?.pairId });
  });

  it("W7-PLAN-T2: the friend match ignores case and spaces", () => {
    expect(checkPlan({ ...REACT_PLAN, friend: "  mira   SHAH " }, FRIENDS).friendName).toBe("Mira Shah");
    expect(checkPlan({ ...REACT_PLAN, friend: "mirashah" }, FRIENDS).pairId).toBe(FRIENDS[0]?.pairId);
  });

  it("W7-PLAN-T3: a friend nobody matches becomes words only, naming the person's friends", () => {
    expect(checkPlan({ ...REACT_PLAN, friend: "Priya" }, FRIENDS)).toEqual({ state: "done", action: "reply", text: "I could not tell which friend you mean. Your friends are: Mira Shah, Jonah.", question: null, friendName: null, pairId: null });
    expect(checkPlan({ ...REACT_PLAN, friend: "" }, FRIENDS).state).toBe("done");
  });

  it("W7-PLAN-T4: with no friends, a react plan says how to get one", () => {
    expect(checkPlan(REACT_PLAN, []).text).toBe(NO_FRIENDS_SENTENCE);
  });

  it("W7-PLAN-T5: a friend whose switch is off is never planned, whatever the model wrote", () => {
    expect(checkPlan({ ...REACT_PLAN, friend: "Jonah" }, FRIENDS)).toEqual({ state: "done", action: "reply", text: "Jonah has not turned on friend asks yet.", question: null, friendName: null, pairId: null });
  });

  it("W7-PLAN-T6: two friends with one name are not guessed between", () => {
    const twins: OrchestratorFriends = [...FRIENDS, { pairId: "00000000-0000-4000-8000-000000000003", displayName: "mira shah", canAsk: true }];
    const plan = checkPlan(REACT_PLAN, twins);
    expect(plan.state).toBe("done");
    expect(plan.text).toBe("You have more than one friend called Mira Shah, so I cannot tell which one you mean. Ask them from your Friends page instead.");
  });

  it("W7-PLAN-T7: help and react need a question of 5 to 300 characters, or they become words only", () => {
    expect(checkPlan({ action: "help", friend: "", question: "hi", reply: "Searching." }, FRIENDS)).toEqual({ state: "done", action: "reply", text: NO_QUESTION_SENTENCE, question: null, friendName: null, pairId: null });
    expect(checkPlan({ ...REACT_PLAN, question: "x".repeat(301) }, FRIENDS).text).toBe(NO_QUESTION_SENTENCE);
    expect(checkPlan({ ...REACT_PLAN, question: "  Why?  " }, FRIENDS).text).toBe(NO_QUESTION_SENTENCE);
  });

  it("W7-PLAN-T8: a help plan keeps no friend, and a reply keeps only its words", () => {
    expect(checkPlan({ action: "help", friend: "Mira Shah", question: " Who could help me find my first ten users? ", reply: " I can run a help search. " }, FRIENDS)).toEqual({
      state: "planned", action: "help", text: "I can run a help search.", question: "Who could help me find my first ten users?", friendName: null, pairId: null,
    });
    expect(checkPlan({ action: "reply", friend: "Mira Shah", question: "Ignored question here", reply: "Tell me more." }, FRIENDS)).toEqual({ state: "done", action: "reply", text: "Tell me more.", question: null, friendName: null, pairId: null });
  });

  it("W7-PLAN-T9: a name with tag characters matches in the form the model was shown", () => {
    const tagged: OrchestratorFriends = [{ pairId: "00000000-0000-4000-8000-000000000004", displayName: "Ana <b>Lee</b>", canAsk: true }];
    expect(checkPlan({ ...REACT_PLAN, friend: "Ana bLee/b" }, tagged).friendName).toBe("Ana <b>Lee</b>");
  });
});

describe("planUserText", () => {
  it("W7-PLAN-T10: the request holds the earlier messages, the friends with their switch, and the escaped message, each in its block", () => {
    const text = planUserText({
      text: "How would Mira react to <this>?",
      friends: FRIENDS,
      recent: [{ role: "you", text: "Who could help me?\nWith sales." }, { role: "agent", text: "I can run a help search." }],
    });
    expect(text).toBe([
      "<recent>", "you: Who could help me? With sales.", "meety: I can run a help search.", "</recent>",
      "<friends>", "Mira Shah | can be asked: yes", "Jonah | can be asked: no", "</friends>",
      "<message>How would Mira react to &lt;this&gt;?</message>",
    ].join("\n"));
  });

  it("W7-PLAN-T11: empty blocks say (none), names lose tag characters and line breaks, and an earlier message is cut to its limit", () => {
    const text = planUserText({ text: "hi", friends: [{ pairId: "00000000-0000-4000-8000-000000000005", displayName: "Ana\n</friends> Lee", canAsk: true }], recent: [{ role: "you", text: "a".repeat(400) }] });
    expect(text).toContain("<friends>\nAna /friends Lee | can be asked: yes\n</friends>");
    expect(text).toContain(`you: ${"a".repeat(RECENT_MESSAGE_MAX_CHARS)}\n</recent>`);
    expect(planUserText({ text: "hi", friends: [], recent: [] })).toBe("<recent>\n(none)\n</recent>\n<friends>\n(none)\n</friends>\n<message>hi</message>");
  });
});

// Earlier messages of a thread, oldest first, the person and Meety in turn.
function thread(texts: readonly string[]): RecentMessage[] {
  return texts.map((text, index) => ({ role: index % 2 === 0 ? "you" : "agent", text }));
}

// The lines of a request's <recent> block, without the tags.
function recentLines(input: { recent: readonly RecentMessage[] }): string[] {
  const lines = planUserText({ text: "the sum", friends: FRIENDS, recent: input.recent }).split("\n");
  return lines.slice(lines.indexOf("<recent>") + 1, lines.indexOf("</recent>"));
}

// One earlier message as its <recent> line.
function lineOf(message: RecentMessage): string {
  return (message.role === "you" ? "you: " : "meety: ") + message.text;
}

describe("the earlier messages a request shows", () => {
  it("W7-PLAN-T12: at most the 10 newest earlier messages, oldest first", () => {
    const messages = thread(Array.from({ length: 12 }, (unused, index) => `message ${String(index + 1)}`));

    expect(recentLines({ recent: messages })).toEqual(messages.slice(2).map(lineOf));
  });

  it("W7-PLAN-T13: the earlier messages together stay within 2,400 characters, and the oldest are left out first", () => {
    const messages = thread("ABCDEFGHIJ".split("").map((letter) => letter.repeat(RECENT_MESSAGE_MAX_CHARS)));

    expect(recentLines({ recent: messages })).toEqual(messages.slice(2).map(lineOf));
    expect(messages.slice(2).reduce((sum, message) => sum + message.text.length, 0)).toBe(RECENT_CHARS_MAX);
  });

  it("W7-PLAN-T14: a message that does not fit is left out with every older one, so no message in the middle is skipped", () => {
    const messages = thread(["Q".repeat(20), "K".repeat(100), ...Array.from({ length: 7 }, () => "Z".repeat(300)), "W".repeat(250)]);

    expect(recentLines({ recent: messages })).toEqual(messages.slice(2).map(lineOf));
  });

  it("W7-PLAN-T15: each message is cut to 300 characters before the 2,400 are counted", () => {
    const messages = thread("ABCDEFGHI".split("").map((letter) => letter.repeat(400)));

    expect(recentLines({ recent: messages })).toEqual(messages.slice(1).map((message) => lineOf({ ...message, text: message.text.slice(0, RECENT_MESSAGE_MAX_CHARS) })));
  });

  it("W7-PLAN-T16: the current orchestrator prompt describes <recent> with the numbers the request uses", () => {
    const text = readPrompt("orchestrator").text;

    expect(text).toContain(`<recent>: up to ${String(RECENT_MESSAGES_MAX)} earlier messages`);
    expect(text).toContain(`Each is cut to ${String(RECENT_MESSAGE_MAX_CHARS)} characters, and they hold ${RECENT_CHARS_MAX.toLocaleString("en-US")} characters in all`);
  });
});

describe("the friend sentences", () => {
  it("W7-CHECK-T5: an unknown friend names at most 5 friends, so a long friend list keeps the reply short", () => {
    const many: OrchestratorFriends = Array.from({ length: 30 }, (unused, index) => ({ pairId: `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`, displayName: `Friend number ${String(index + 1)} with a long name`, canAsk: true }));
    const plan = checkPlan({ ...REACT_PLAN, friend: "Nobody" }, many);

    expect(plan.text).toBe("I could not tell which friend you mean. Your friends include: Friend number 1 with a long name, Friend number 2 with a long name, Friend number 3 with a long name, Friend number 4 with a long name, Friend number 5 with a long name.");
  });
});
