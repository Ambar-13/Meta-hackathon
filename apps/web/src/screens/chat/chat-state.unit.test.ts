import { describe, expect, it } from "vitest";
import { threadOf, replied, youSaid, chatId } from "./chat-fixtures.js";
import { readDraftQuery } from "./chat-state.js";
import { ANSWER_LINE_MAX, chipTexts, firstSentence, greetingOf, joinsPrevious, messageBefore, shouldPollThread, shownMessages, startsTimeLine, timeLineOf } from "./chat-words.js";

describe("chat words", () => {
  it("W7-WEB-B-U1: the chips name the first two friends, else Mira and my investor", () => {
    expect(chipTexts([{ displayName: "Bea" }, { displayName: "Cal" }, { displayName: "Dee" }])).toEqual([
      "Who could help me get my first ten users?",
      "How would Bea react if I moved our trip to March?",
      "How would Cal prefer a seed extension over a bridge round?",
    ]);
    expect(chipTexts([{ displayName: "Bea" }])[2]).toBe("How would my investor prefer a seed extension over a bridge round?");
    expect(chipTexts([])[1]).toBe("How would Mira react if I moved our trip to March?");
    expect(chipTexts(null)[2]).toBe("How would my investor prefer a seed extension over a bridge round?");
  });

  it("W7-WEB-B-U2: the greeting carries the name when it is known", () => {
    expect(greetingOf("Ana")).toBe("Hi Ana, what do you want to find out?");
    expect(greetingOf(null)).toBe("What do you want to find out?");
    expect(greetingOf("  ")).toBe("What do you want to find out?");
  });

  it("W7-WEB-B-U3: an answer line is its first sentence, at most 140 characters, cut at a word with ...", () => {
    expect(firstSentence("She would probably say yes. Then she would ask why.")).toBe("She would probably say yes.");
    expect(firstSentence("  No full stop here  ")).toBe("No full stop here");
    expect(firstSentence("Is it March? Maybe.")).toBe("Is it March?");
    const long = `${"word ".repeat(40)}end.`;
    const cut = firstSentence(long);
    expect(cut.length).toBeLessThanOrEqual(ANSWER_LINE_MAX);
    expect(cut.endsWith("word...")).toBe(true);
    const unbroken = "x".repeat(200);
    expect(firstSentence(unbroken)).toBe(`${"x".repeat(137)}...`);
  });

  it("W7-WEB-B-U4: the thread is read again only while a reply is thinking", () => {
    expect(shouldPollThread(threadOf([youSaid(chatId(1), "Hi"), replied(chatId(2), { state: "thinking" })]))).toBe(true);
    expect(shouldPollThread(threadOf([replied(chatId(2), { state: "running", action: "help", askId: chatId(3) })]))).toBe(false);
    expect(shouldPollThread(threadOf([]))).toBe(false);
  });

  it("W7-WEB-B-U5: the draft comes from the draft query, cut to 500 characters", () => {
    expect(readDraftQuery("?draft=How%20would%20Mira%20react%20to%20")).toBe("How would Mira react to ");
    expect(readDraftQuery("?draft=")).toBeNull();
    expect(readDraftQuery("")).toBeNull();
    expect(readDraftQuery(`?draft=${"a".repeat(600)}`)?.length).toBe(500);
  });

  it("W7-WEB-B-U6: Try again finds the person's message before a reply, and sent messages wait until the thread holds them", () => {
    const messages = [youSaid(chatId(1), "First"), replied(chatId(2), {}), youSaid(chatId(3), "Second"), replied(chatId(4), { state: "failed" })];
    expect(messageBefore(messages, chatId(4))).toBe("Second");
    expect(messageBefore(messages, chatId(2))).toBe("First");
    expect(messageBefore(messages, chatId(9))).toBeNull();
    const ran = new Map([[chatId(2), replied(chatId(2), { text: "Ran" })]]);
    const shown = shownMessages({ server: messages.slice(0, 2), ran, sent: [messages[2], messages[1]].filter((m) => m !== undefined) });
    expect(shown.map((m) => m.id)).toEqual([chatId(1), chatId(2), chatId(3)]);
    expect(shown[1]?.text).toBe("Ran");
  });
});

describe("time lines and groups in the thread", () => {
  // A message on one side sent at this local time.
  const at = (n: number, role: "you" | "agent", time: Date) => ({ ...(role === "you" ? youSaid(chatId(80 + n), "Hi") : replied(chatId(80 + n), { text: "Hello" })), createdAt: time.toISOString() });

  it("W7-CHAT-U1: a time line says Today, Yesterday, the weekday within a week, or the date, with the local time on a 12-hour clock", () => {
    const now = new Date(2026, 10, 3, 15, 0);

    expect(timeLineOf(new Date(2026, 10, 3, 14, 41).toISOString(), now)).toBe("Today 2:41 PM");
    expect(timeLineOf(new Date(2026, 10, 3, 0, 5).toISOString(), now)).toBe("Today 12:05 AM");
    expect(timeLineOf(new Date(2026, 10, 2, 9, 10).toISOString(), now)).toBe("Yesterday 9:10 AM");
    expect(timeLineOf(new Date(2026, 9, 30, 21, 0).toISOString(), now)).toBe("Fri 9:00 PM");
    expect(timeLineOf(new Date(2026, 9, 20, 9, 10).toISOString(), now)).toBe("Oct 20, 9:10 AM");
  });

  it("W7-CHAT-U2: the first message and any after a 30-minute pause start a time line; a message joins the one before it on the same side with no time line between", () => {
    const start = new Date(2026, 10, 3, 14, 0);
    const minutes = (m: number): Date => new Date(start.getTime() + m * 60_000);
    const messages = [at(1, "you", minutes(0)), at(2, "you", minutes(1)), at(3, "agent", minutes(2)), at(4, "agent", minutes(40)), at(5, "you", minutes(41))];

    expect(messages.map((message) => startsTimeLine(messages, messages.indexOf(message)))).toEqual([true, false, false, true, false]);
    expect(messages.map((message) => joinsPrevious(messages, messages.indexOf(message)))).toEqual([false, true, false, false, false]);
    expect(startsTimeLine([], 0)).toBe(false);
  });
});
