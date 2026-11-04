import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HELP_SEND_COPY, type Friend, type OrchestratorMessage } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import {
  answerFrom,
  askOf,
  CHAT_IDS,
  chatId,
  friendsOf,
  homeOf,
  JONAH,
  MIRA,
  plannedReact,
  replied,
  threadOf,
  TRIP_QUESTION,
  youSaid,
} from "./chat-fixtures.js";
import { ChatScreen } from "./screen.js";

beforeEach(() => {
  clearClientState();
});

afterEach(() => {
  cleanup();
});

// The cap sentence the api sends with a 429 on POST /api/orchestrator.
const CAP_SENTENCE = "You have sent today's messages to Meety. Try again tomorrow.";

// Stubs the three reads of the page: the thread (a list is served in order), the home view and the
// friends list.
function stubReads(input: {
  thread: OrchestratorMessage[][];
  hasCard?: boolean;
  friends?: Friend[];
}): void {
  stubRoute(
    routes.social.readThread,
    input.thread.map((messages) => ({ status: 200, body: threadOf(messages) })),
  );
  stubRoute(routes.people.readHome, homeOf(input.hasCard ?? true));
  stubRoute(routes.directory.friends, friendsOf(input.friends ?? [MIRA, JONAH]));
}

// Renders the chat page at /meety, with this query.
function renderChat(search = ""): void {
  renderScreen(<ChatScreen />, {
    pattern: ROUTE_PATTERNS.meety,
    url: `${APP_PATHS.meety}${search}`,
  });
}

// The composer's text box.
function composer(): HTMLTextAreaElement {
  return screen.getByLabelText("Ask Meety, your personal AI");
}

// The orchestrator's replies on the page, in order.
function replies(): HTMLElement[] {
  return screen.queryAllByRole("article", { name: "Meety replied" });
}

// The chips under an empty thread, as their words.
async function chipWords(): Promise<string[]> {
  const group = await screen.findByRole("group", { name: "Examples to start from" });
  return within(group)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("chat screen", () => {
  it("W7-WEB-B-T1: the empty thread shows the greeting with the person's name and three chips, and a chip fills the composer and sends nothing", async () => {
    stubReads({ thread: [[]] });
    stubRoute(routes.social.sendToOrchestrator, {
      status: 202,
      body: { messageId: CHAT_IDS.sent, replyId: CHAT_IDS.reply },
    });
    renderChat();

    expect(
      await screen.findByRole("heading", { name: "Hi Ana, what do you want to find out?" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Ask who could help you, or how a friend would probably react."),
    ).toBeTruthy();
    expect(screen.queryByText(/Nothing goes to anyone's Meety/)).toBeNull();
    expect(await chipWords()).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: "Who could help me get my first ten users?" }),
    );
    expect(composer().value).toBe("Who could help me get my first ten users?");
    await waitFor(() => {
      expect(document.activeElement).toBe(composer());
    });
    expect(composer().selectionStart).toBe(composer().value.length);
    expect(requestsTo(routes.social.sendToOrchestrator)).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "Meety" })).toBeTruthy();
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W7-WEB-B-T2: with friends Mira and Jonah chip 2 names Mira and chip 3 names Jonah; with no friends they read Mira and my investor", async () => {
    stubReads({ thread: [[]], friends: [MIRA, JONAH] });
    renderChat();
    await screen.findByText("How would Jonah prefer a seed extension over a bridge round?");
    expect(await chipWords()).toEqual([
      "Who could help me get my first ten users?",
      "How would Mira react if I moved our trip to March?",
      "How would Jonah prefer a seed extension over a bridge round?",
    ]);
    cleanup();

    stubReads({ thread: [[]], friends: [] });
    renderChat();
    await screen.findByText("How would my investor prefer a seed extension over a bridge round?");
    expect((await chipWords()).slice(1)).toEqual([
      "How would Mira react if I moved our trip to March?",
      "How would my investor prefer a seed extension over a bridge round?",
    ]);
  });

  it("W7-WEB-B-T3: typing and pressing Send posts the text, shows the bubble and the thinking reply, and clears the composer", async () => {
    const text = "Who could help me with my pitch deck?";
    stubReads({
      thread: [[], [youSaid(CHAT_IDS.sent, text), replied(CHAT_IDS.reply, { state: "thinking" })]],
    });
    stubRoute(routes.social.sendToOrchestrator, {
      status: 202,
      body: { messageId: CHAT_IDS.sent, replyId: CHAT_IDS.reply },
    });
    renderChat();
    await screen.findByRole("heading", { name: "Hi Ana, what do you want to find out?" });

    fireEvent.change(composer(), { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const bubble = await screen.findByRole("article", { name: "You said" });
    expect(bubble.textContent).toBe(text);
    expect(requestsTo(routes.social.sendToOrchestrator).map((request) => request.body)).toEqual([
      { text },
    ]);
    expect(within(replies()[0] ?? document.body).getByText("Working out what to do")).toBeTruthy();
    expect(
      within(replies()[0] ?? document.body).getByRole("status", { name: "Working out what to do" }),
    ).toBeTruthy();
    expect(composer().value).toBe("");
    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.getAllByRole("article", { name: "You said" })).toHaveLength(1);
  });

  it("W7-WEB-B-T4: Enter sends, and Shift with Enter does not", async () => {
    stubReads({ thread: [[]] });
    stubRoute(routes.social.sendToOrchestrator, {
      status: 202,
      body: { messageId: CHAT_IDS.sent, replyId: CHAT_IDS.reply },
    });
    renderChat();
    await screen.findByRole("heading", { name: "Hi Ana, what do you want to find out?" });

    fireEvent.change(composer(), { target: { value: "First line" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(requestsTo(routes.social.sendToOrchestrator)).toHaveLength(0);

    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => {
      expect(requestsTo(routes.social.sendToOrchestrator)).toHaveLength(1);
    });
    expect(requestsTo(routes.social.sendToOrchestrator)[0]?.body).toEqual({ text: "First line" });
  });

  it("W7-WEB-B-T5: a planned react reply shows its text and Ask Mira's Meety, and pressing it posts to the reply's run route", async () => {
    const plan = plannedReact(CHAT_IDS.reply);
    stubReads({
      thread: [
        [youSaid(CHAT_IDS.sent, "How would Mira react if I moved our trip to March?"), plan],
      ],
    });
    stubRoute(routes.social.runPlan, { ...plan, state: "running", askId: CHAT_IDS.ask });
    stubRoute(routes.asks.readAsk, askOf({ state: "asking" }));
    renderChat();

    expect(await screen.findByText(plan.text)).toBeTruthy();
    expect(screen.getByText(`“${TRIP_QUESTION}”`)).toBeTruthy();
    expect(
      screen.getByText(
        "Mira's Meety answers from what Mira chose to share. Mira gets a copy of the answer.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask Mira's Meety" }));

    await waitFor(() => {
      expect(requestsTo(routes.social.runPlan)).toHaveLength(1);
    });
    expect(new URL(requestsTo(routes.social.runPlan)[0]?.url ?? "").pathname).toBe(
      `/api/orchestrator/${CHAT_IDS.reply}/run`,
    );
    expect(await screen.findByText("Their Meetys are answering")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask Mira's Meety" })).toBeNull();
  });

  it("W7-WEB-B-T6: a running reply's card shows Their Meetys are answering, then the answers' first sentences and See all the answers", async () => {
    const running = replied(CHAT_IDS.reply, {
      state: "running",
      action: "help",
      text: "I started a help search.",
      actionQuestion: "Who could help me get my first ten users?",
      askId: CHAT_IDS.ask,
    });
    stubReads({
      thread: [[youSaid(CHAT_IDS.sent, "Who could help me get my first ten users?"), running]],
    });
    const answers = [
      answerFrom(1, "Bea", "Bea would probably start with a waitlist. She did that twice."),
      answerFrom(2, "Cal", "Cal would probably post in student groups first."),
    ];
    stubRoute(routes.asks.readAsk, [
      askOf({ mode: "help", state: "asking" }),
      askOf({ mode: "help", state: "done", answers }),
    ]);
    renderChat();

    expect(await screen.findByText("Their Meetys are answering")).toBeTruthy();
    expect(
      await screen.findByText("Bea would probably start with a waitlist.", {}, { timeout: 6_000 }),
    ).toBeTruthy();
    expect(screen.getByText("Cal would probably post in student groups first.")).toBeTruthy();
    expect(screen.queryByText("She did that twice.", { exact: false })).toBeNull();
    expect(screen.getByRole("link", { name: "See all the answers" }).getAttribute("href")).toBe(
      `/asks/${CHAT_IDS.ask}`,
    );
    expect(screen.getByText("Finding who could help")).toBeTruthy();
  });

  it("W7-WEB-B-T7: a done reply with a refusal shows its text and no button", async () => {
    const text =
      "I can ask Mira's agent how she would probably take a March trip.\n\nMira has not turned on friend asks yet.";
    stubReads({
      thread: [
        [
          youSaid(CHAT_IDS.sent, "How would Mira react?"),
          replied(CHAT_IDS.reply, {
            state: "done",
            action: "react",
            text,
            actionQuestion: TRIP_QUESTION,
            actionFriendName: "Mira",
          }),
        ],
      ],
    });
    renderChat();

    await waitFor(() => {
      expect(replies()).toHaveLength(1);
    });
    const reply = replies()[0] ?? document.body;
    expect(reply.querySelector(".chat-text")?.textContent).toBe(text);
    expect(within(reply).queryAllByRole("button")).toHaveLength(0);
  });

  it("W7-WEB-B-T8, changed on 3 Nov after the wave 7 check: a failed reply shows its sentence, and Ask again sends the message before it again in one press", async () => {
    const sentence = "I could not work that out just now. Try again in a minute.";
    const earlier = "How would Jonah react to a later demo?";
    stubReads({
      thread: [
        [
          youSaid(chatId(1), "Older message"),
          replied(chatId(2), { text: "Done." }),
          youSaid(chatId(3), earlier),
          replied(chatId(4), { state: "failed", text: sentence }),
        ],
      ],
    });
    stubRoute(routes.social.sendToOrchestrator, {
      status: 202,
      body: { messageId: CHAT_IDS.sent, replyId: CHAT_IDS.reply },
    });
    renderChat();

    expect(await screen.findByText(sentence)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    await waitFor(() => {
      expect(requestsTo(routes.social.sendToOrchestrator).map((request) => request.body)).toEqual([
        { text: earlier },
      ]);
    });
    expect(composer().value).toBe("");
  });

  it("W7-CHECK-T1: a planned help search's card says who gets a copy of the question, as the help page does", async () => {
    stubReads({
      thread: [
        [
          youSaid(chatId(1), "Who could help me with sales?"),
          replied(chatId(2), {
            state: "planned",
            action: "help",
            actionQuestion: "Who could help me with sales?",
            text: "I can run a help search.",
          }),
        ],
      ],
    });
    renderChat();

    const card = await screen.findByRole("region", { name: "The plan" });
    expect(within(card).getByText(HELP_SEND_COPY)).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Find who could help" })).toBeTruthy();
  });

  it("W7-CHECK-T2: a running reply whose ask is gone says so, instead of showing nothing under its words", async () => {
    stubReads({
      thread: [
        [
          youSaid(chatId(1), "How would Jonah react to a later demo?"),
          replied(chatId(2), {
            state: "running",
            action: "react",
            actionQuestion: "How would you react?",
            actionFriendName: "Jonah",
            askId: null,
            text: "I can ask Jonah's agent.",
          }),
        ],
      ],
    });
    renderChat();

    expect(
      await screen.findByText("This ask is no longer here. Send your message again to ask again."),
    ).toBeTruthy();
  });

  it("W7-WEB-B-T9: a 429 on send shows the api's sentence and keeps the text in the composer", async () => {
    stubReads({ thread: [[]] });
    stubRoute(routes.social.sendToOrchestrator, {
      status: 429,
      body: { code: "orchestrator_daily_cap", message: CAP_SENTENCE },
    });
    renderChat();
    await screen.findByRole("heading", { name: "Hi Ana, what do you want to find out?" });

    fireEvent.change(composer(), { target: { value: "One more question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toContain(CAP_SENTENCE);
    expect(composer().value).toBe("One more question");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("W7-WEB-B-T10: rendered at /home?draft=How%20would%20Mira%20react%20to%20 the composer holds the draft and has the focus", async () => {
    stubReads({ thread: [[]] });
    renderChat("?draft=How%20would%20Mira%20react%20to%20");

    expect(composer().value).toBe("How would Mira react to ");
    await waitFor(() => {
      expect(document.activeElement).toBe(composer());
    });
    expect(composer().selectionStart).toBe("How would Mira react to ".length);
  });

  it("W7-WEB-B-T11: with no approved card, the next step shows above the greeting", async () => {
    stubReads({ thread: [[]], hasCard: false });
    renderChat();

    const step = await screen.findByRole("region", { name: "Your next step" });
    const greeting = await screen.findByRole("heading", {
      name: "Hi Ana, what do you want to find out?",
    });
    expect(within(step).getByText("Add your notes.")).toBeTruthy();
    expect(within(step).getByRole("link", { name: "Add your notes" }).getAttribute("href")).toBe(
      "/upload",
    );
    expect(step.compareDocumentPosition(greeting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    stubReads({ thread: [[]], hasCard: true });
    renderChat();
    await screen.findByRole("heading", { name: "Hi Ana, what do you want to find out?" });
    expect(screen.queryByRole("region", { name: "Your next step" })).toBeNull();
  });

  it("W7-SAMPLE-WEB-T5: Add friend on a suggested sample person reads as friends at once and reads the friends list again, and a real person reads as requested", async () => {
    const mayaListing = chatId(80);
    const leoListing = chatId(81);
    const maya = {
      listingId: mayaListing,
      displayName: "Maya",
      line: "Angel investor.",
      openToRomance: false,
      isSample: true,
      items: [],
    };
    const leo = {
      listingId: leoListing,
      displayName: "Leo",
      line: "Writes the backend.",
      openToRomance: false,
      isSample: false,
      items: [],
    };
    stubRoute(routes.social.readThread, [{ status: 200, body: threadOf([]) }]);
    stubRoute(routes.people.readHome, homeOf(true));
    stubRoute(routes.directory.friends, [
      friendsOf([MIRA]),
      friendsOf([
        MIRA,
        { pairId: chatId(82), displayName: "Maya", canAsk: true, listingId: mayaListing },
      ]),
    ]);
    stubRoute(routes.directory.browse, [{ listings: [maya, leo], page: 0, hasMore: false }]);
    stubRoute(routes.social.sendFriendRequest, [
      { status: 201, body: { requestId: chatId(83) } },
      { status: 201, body: { requestId: chatId(84) } },
    ]);
    renderChat();
    const suggested = await screen.findByRole("region", { name: "Suggested for you" });

    expect(within(suggested).getByText("Sample")).toBeTruthy();
    fireEvent.click(within(suggested).getByRole("button", { name: "Add Maya as a friend" }));
    const stories = screen.getByRole("navigation", { name: "Friends" });
    expect(await within(stories).findByRole("link", { name: "Maya" })).toBeTruthy();
    expect(requestsTo(routes.social.sendFriendRequest)[0]?.body).toEqual({
      listingId: mayaListing,
    });
    expect(within(suggested).queryByRole("button", { name: "Add Maya as a friend" })).toBeNull();

    fireEvent.click(within(suggested).getByRole("button", { name: "Add Leo as a friend" }));
    expect(await within(suggested).findByText("Requested")).toBeTruthy();
    expect(requestsTo(routes.directory.friends)).toHaveLength(2);
  });

  it("W7-CHAT-T1: Meety's logo sits in line with its name over a run of its replies, a later reply in the run carries no name, and a time line opens the thread", async () => {
    const asked = youSaid(chatId(60), "Who could help me?");
    const first = replied(chatId(61), { text: "I can ask around." });
    const second = replied(chatId(62), { text: "Or ask a friend's Meety." });
    stubReads({ thread: [[asked, first, second]] });
    renderChat();
    await waitFor(() => {
      expect(replies()).toHaveLength(2);
    });
    const [opening, following] = replies() as [HTMLElement, HTMLElement];
    const name = opening.querySelector(".chat-who");

    expect(name?.textContent).toBe("Meety");
    expect(name?.querySelector(".meety-mark")).not.toBeNull();
    expect(following.querySelector(".chat-who")).toBeNull();
    expect(following.classList.contains("joins-prev")).toBe(true);
    expect(document.querySelectorAll(".chat-time")).toHaveLength(1);
    expect(
      document
        .querySelector(".chat-time")
        ?.compareDocumentPosition(screen.getByRole("article", { name: "You said" })) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
