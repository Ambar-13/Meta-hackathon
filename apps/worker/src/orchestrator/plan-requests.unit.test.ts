import { describe, expect, it } from "vitest";
import type { OrchestratorFriends, OrchestratorPlanOutput } from "@meet-first/contracts";
import { checkPlan, NO_FRIENDS_SENTENCE, NO_QUESTION_SENTENCE, planUserText, RECENT_MESSAGE_MAX_CHARS } from "./plan-requests.js";

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
