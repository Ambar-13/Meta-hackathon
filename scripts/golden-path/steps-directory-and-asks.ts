// Steps 16 to 21: B shares three items, turns on friend asks and lists in the directory; A meets B's listed persona on a debate,
// asks how B would probably react, and asks the directory for help.
import { CURATED_QUESTIONS, DIRECTORY_SWITCH_COPY, ErrorBody, HELP_RESULTS_HEADING, routes, type AskView, type Brief, type CardItem } from "@meet-first/contracts";
import { readAnswerTurnIds, readBriefOwners, readMeeting, readMembers } from "./database-reads.js";
import { DIRECTORY_QUESTION_ID, HELP_ASK_TEXT, HELP_ITEM_WORDS, LISTING_LINE, PUBLIC_ITEM_COUNT, REACT_ASK_TEXT, ROMANCE_QUESTION_ID } from "./fixtures.js";
import type { PersonClient } from "./person-client.js";
import { check, finishStep, need, pollUntil, routePath, StepFailure, type Assertion, type RunState, type StepResult } from "./report.js";
import { readCardView } from "./steps-people-and-sources.js";
import { readMeetingView } from "./steps-quiz-approve-pair.js";

// The directory meeting may take 75 s to start, as the invite meeting may (step 7).
const START_TIMEOUT_MS = 75_000;
const START_POLL_MS = 1_000;
// The directory meeting may run for 14 minutes, as the invite meeting may (step 12).
const MEETING_WAIT_MS = 840_000;
const MEETING_POLL_MS = 2_000;
// Both briefs may take 300 s after the meeting ends (step 13).
const BRIEF_WAIT_MS = 300_000;
const BRIEF_POLL_MS = 3_000;
// An ask may take 180 s: the question check, up to 20 persona calls through the limiter, then the support check.
const ASK_WAIT_MS = 180_000;
const ASK_POLL_MS = 3_000;
// The states an ask stops in.
const ASK_FINAL_STATES = new Set(["done", "refused", "failed"]);
// The keys a listing and a public item may carry in the directory, and nothing else.
const LISTING_KEYS = ["displayName", "isSample", "items", "line", "listingId", "openToRomance", "photo"];
const PUBLIC_ITEM_KEYS = ["claim", "kind", "quote"];

// The text of a curated question, or a failed step when the bank has no such id.
function curatedText(questionId: number): string {
  const question = CURATED_QUESTIONS.find((item) => item.id === questionId);
  if (question === undefined) throw new StepFailure(`question_missing: the curated bank has no question ${String(questionId)}.`);
  return question.text;
}

// The words of a text, lower case, four letters or more, so short common words do not count as a match.
function matchWordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
}

// The shareable item a card offers for the help search: the one sharing the most words with the help question, the lowest position
// on a tie. A real model words B's notes its own way, so a replay of its recording picks the item the recording run picked.
function closestHelpItem(shareable: readonly CardItem[]): CardItem | undefined {
  const asked = matchWordsOf(HELP_ASK_TEXT);
  const scored = shareable.map((item) => ({ item, shared: [...matchWordsOf(`${item.claim} ${item.quote}`)].filter((word) => asked.has(word)).length }));
  const best = scored.filter((entry) => entry.shared > 0).sort((first, second) => second.shared - first.shared || first.item.position - second.item.position)[0];
  return best?.item;
}

// The items B makes public: the item the help search must find, and the first others in position order, three in all. The help item
// is the one that quotes HELP_ITEM_WORDS when the card has it, else the item closest to the help question, under --mock as on a live run.
function publicItemsOf(items: readonly CardItem[]): CardItem[] {
  const shareable = items.filter((item) => item.approved && item.verified && !item.sensitive);
  const helpItem = shareable.find((item) => item.quote.includes(HELP_ITEM_WORDS)) ?? closestHelpItem(shareable);
  if (helpItem === undefined) throw new StepFailure(`help_item_missing: no shareable item of B quotes "${HELP_ITEM_WORDS}" or shares a word with the help question, and the help step needs it public.`);
  const others = shareable.filter((item) => item !== helpItem).slice(0, PUBLIC_ITEM_COUNT - 1);
  return [...others, helpItem].sort((first, second) => first.position - second.position);
}

// Step 16: B makes three items public, turns on friend asks and lists in the directory with a line.
export async function step16Sharing(run: RunState): Promise<StepResult> {
  const cardB = need(run.ids.cardB, "cardB");
  const view = await readCardView(run.b, cardB);
  const shared = publicItemsOf(view.items);
  const positions = shared.map((item) => item.position);
  const sharingPath = routePath(routes.directory.updateSharing.path, { id: cardB });
  const before = await run.b.json({ method: "GET", path: sharingPath, expect: 200, schema: routes.directory.readSharing.response });
  const after = await run.b.json({ method: "PUT", path: sharingPath, body: { friendsCanAsk: true, publicPositions: positions }, expect: 200, schema: routes.directory.updateSharing.response });
  const listed = await run.b.json({ method: "PUT", path: routes.directory.upsertMyListing.path, body: { cardId: cardB, line: LISTING_LINE, openToRomance: false }, expect: 200, schema: routes.directory.upsertMyListing.response });
  run.ids.listingB = listed.body.listingId;
  run.facts.publicQuotesB = shared.map((item) => item.quote);
  run.facts.publicTurnIdsB = shared.map((item) => item.turnId);
  const assertions: Assertion[] = [
    check("nothing of B is shared before B chooses", { friendsCanAsk: false, publicPositions: [] }, before.body),
    check("B's sharing holds friend asks and three public items", { friendsCanAsk: true, publicPositions: positions }, after.body),
    check("B's listing uses B's card and line", { cardId: cardB, line: LISTING_LINE }, { cardId: listed.body.cardId, line: listed.body.line }),
    check("B's listing holds exactly the public items", run.facts.publicQuotesB, listed.body.items.map((item) => item.quote)),
    check("B's listing is closed to dating questions", false, listed.body.openToRomance),
  ];
  run.manual.push(`the card screen shows the directory switch ("${DIRECTORY_SWITCH_COPY.slice(0, 44)}...") and the friends switch, both off by default`);
  return finishStep(16, "sharing", { rows: ["P1", "P2", "P3"], detail: `B lists with ${String(positions.length)} public items; friend asks on`, assertions });
}

// The checks on B's listing as A finds it: B's name and line, exactly the public items, and no field beyond the listing's own.
function listingChecks(run: RunState, listing: { listingId: string; displayName: string; line: string; items: Array<{ quote: string }> } | undefined): Assertion[] {
  return [
    check("A finds B's listing in the directory", true, listing !== undefined),
    check("the listing names B with B's line", { displayName: "B", line: LISTING_LINE }, { displayName: listing?.displayName, line: listing?.line }),
    check("the listing shows exactly B's public items", run.facts.publicQuotesB, listing?.items.map((item) => item.quote)),
    check("a listing carries only listing fields", LISTING_KEYS, Object.keys(listing ?? {}).sort()),
    check("a public item carries only its kind, claim and quote", true, (listing?.items ?? []).every((item) => Object.keys(item).sort().join() === PUBLIC_ITEM_KEYS.join())),
  ];
}

// Step 17: A browses the directory, finds B's listing, is refused a dating question, and starts a meeting with B's listed persona on
// curated question 13. The meeting starts by itself, with B's side speaking from public items only.
export async function step17Directory(run: RunState): Promise<StepResult> {
  const cardA = need(run.ids.cardA, "cardA");
  const listingB = need(run.ids.listingB, "listingB");
  const pageA = await run.a.json({ method: "GET", path: routes.directory.browse.path, expect: 200, schema: routes.directory.browse.response });
  const pageB = await run.b.json({ method: "GET", path: routes.directory.browse.path, expect: 200, schema: routes.directory.browse.response });
  const assertions = listingChecks(run, pageA.body.listings.find((item) => item.listingId === listingB));
  assertions.push(check("B's own listing is left out of B's directory", false, pageB.body.listings.some((item) => item.listingId === listingB)));
  const meetPath = routePath(routes.directory.createListingMeeting.path, { id: listingB });
  const romance = await run.a.json({ method: "POST", path: meetPath, body: { questionId: ROMANCE_QUESTION_ID, cardId: cardA }, expect: 409, schema: ErrorBody });
  assertions.push(check("a dating question is refused while B's dating switch is off", "romance_not_open", romance.body.code));
  const created = await run.a.json({ method: "POST", path: meetPath, body: { questionId: DIRECTORY_QUESTION_ID, cardId: cardA }, expect: 201, schema: routes.directory.createListingMeeting.response });
  const meetingId = created.body.meetingId;
  run.ids.directoryMeetingId = meetingId;
  const started = await pollUntil(() => readMeetingView(run.a, meetingId), (view) => view.state === "running" || view.state === "ended", { timeoutMs: START_TIMEOUT_MS, intervalMs: START_POLL_MS });
  const members = await readMembers(run.db, meetingId);
  assertions.push(
    check("the directory meeting starts by itself", true, started.state === "running" || started.state === "ended"),
    check("the meeting asks the debate question, already checked", { questionText: curatedText(DIRECTORY_QUESTION_ID), questionKind: "debate", questionChecked: true }, { questionText: started.questionText, questionKind: started.questionKind, questionChecked: started.questionChecked }),
    check("A is side a and B's listed persona is side b", { viewerSide: "a", sideB: "B" }, { viewerSide: started.viewerSide, sideB: started.members.find((member) => member.side === "b")?.displayName }),
    check("only side b speaks from public items", [false, true], members.map((member) => member.publicOnly)),
  );
  return finishStep(17, "directory", { rows: ["P1", "P2", "P6", "P8"], detail: `directory meeting ${started.state} on question ${String(DIRECTORY_QUESTION_ID)}`, assertions });
}

// Step 18: the directory meeting ends, and under --mock it ends because it decided.
export async function step18DirectoryDecide(run: RunState): Promise<StepResult> {
  const meetingId = need(run.ids.directoryMeetingId, "directoryMeetingId");
  const row = await pollUntil(() => readMeeting(run.db, meetingId), (value) => value.state === "ended", { timeoutMs: MEETING_WAIT_MS, intervalMs: MEETING_POLL_MS });
  const assertions: Assertion[] = [check("the directory meeting ends", "ended", row.state)];
  if (run.options.mode === "mock") assertions.push(check("the directory meeting ended because it decided", "decided", row.end_reason));
  return finishStep(18, "dir-decide", { rows: ["R5.8", "design section 9"], detail: `directory meeting ${row.state}, ${String(row.end_reason)}`, assertions });
}

// Every quote of one side in a brief.
function quotesOf(brief: Brief, side: "a" | "b"): Array<{ turnId: string }> {
  return [...brief.agree, ...brief.clash, ...brief.decideFirst].flatMap((point) => point.quotes).filter((quote) => quote.side === side);
}

// Step 19: A and B each have a brief of the debate; every quote of B in either brief comes from a turn behind one of B's public items,
// and B's listed meetings show the meeting with A.
export async function step19DirectoryBrief(run: RunState): Promise<StepResult> {
  const meetingId = need(run.ids.directoryMeetingId, "directoryMeetingId");
  const publicTurns = need(run.facts.publicTurnIdsB, "publicTurnIdsB");
  const owners = await pollUntil(() => readBriefOwners(run.db, meetingId), (rows) => rows.length === 2, { timeoutMs: BRIEF_WAIT_MS, intervalMs: BRIEF_POLL_MS });
  const briefPath = routePath(routes.briefs.readBrief.path, { id: meetingId });
  const briefA = (await run.a.json({ method: "GET", path: briefPath, expect: 200, schema: routes.briefs.readBrief.response })).body;
  const briefB = (await run.b.json({ method: "GET", path: briefPath, expect: 200, schema: routes.briefs.readBrief.response })).body;
  const quotesB = [...quotesOf(briefA, "b"), ...quotesOf(briefB, "b")];
  const listed = await run.b.json({ method: "GET", path: routes.directory.listedMeetings.path, expect: 200, schema: routes.directory.listedMeetings.response });
  const meeting = listed.body.meetings.find((item) => item.meetingId === meetingId);
  const assertions: Assertion[] = [
    check("each side has its own brief", 2, owners.length),
    check("both briefs are of the debate", ["debate", "debate"], [briefA.questionKind, briefB.questionKind]),
    check("B is quoted in the briefs", true, quotesB.length >= 1),
    check("every quote of B comes from a turn behind a public item", true, quotesB.every((quote) => publicTurns.includes(quote.turnId))),
    check("B's listed meetings show the meeting with A", { otherDisplayName: "A", questionText: curatedText(DIRECTORY_QUESTION_ID) }, { otherDisplayName: meeting?.otherDisplayName, questionText: meeting?.questionText }),
  ];
  // How many lines the support judge backs is the model's choice; the recorded judge left several unsupported, so no run counts them.
  run.manual.push("the directory brief reads the debate labels: where you agree, where you split, the strongest point on each side");
  return finishStep(19, "dir-brief", { rows: ["P1", "P4", "P6"], detail: `both briefs ready; B quoted ${String(quotesB.length)} time(s), all from public items`, assertions });
}

// Polls one ask as its asker until it stops: done, refused or failed.
async function waitForAsk(client: PersonClient, askId: string): Promise<AskView> {
  const path = routePath(routes.asks.readAsk.path, { id: askId });
  return pollUntil(async () => (await client.json({ method: "GET", path, expect: 200, schema: routes.asks.readAsk.response })).body, (view) => ASK_FINAL_STATES.has(view.state), { timeoutMs: ASK_WAIT_MS, intervalMs: ASK_POLL_MS });
}

// The answers B's persona gave, as B's own copies: mode, ask text and asker, newest first.
async function readCopiesOfB(run: RunState): Promise<Array<{ mode: string; text: string; askerName: string }>> {
  const asks = await run.b.json({ method: "GET", path: routes.asks.listAsks.path, expect: 200, schema: routes.asks.listAsks.response });
  return asks.body.aboutMe.map((copy) => ({ mode: copy.mode, text: copy.text, askerName: copy.askerName }));
}

// Step 20: A finds B among their friends by the invite pair alone, asks how B would probably react, and gets B's persona's answer
// with a verified quote. B gets a copy with A's name.
export async function step20FriendAsk(run: RunState): Promise<StepResult> {
  const pairId = need(run.ids.pairId, "pairId");
  const friends = await run.a.json({ method: "GET", path: routes.directory.friends.path, expect: 200, schema: routes.directory.friends.response });
  const created = await run.a.json({ method: "POST", path: routes.asks.createAsk.path, body: { mode: "react", pairId, text: REACT_ASK_TEXT }, expect: 201, schema: routes.asks.createAsk.response });
  run.ids.reactAskId = created.body.askId;
  const view = await waitForAsk(run.a, created.body.askId);
  const answer = view.answers[0];
  const notes: string[] = [];
  const assertions: Assertion[] = [
    check("A's friends are B alone, by the invite pair, with B's listing", [{ pairId, displayName: "B", canAsk: true, listingId: run.ids.listingB ?? null, isSample: false, photo: null }], friends.body.friends),
    check("the friend ask is done", "done", view.state),
    check("the ask is about B", "B", view.aboutName),
    check("one answer, from B's persona", ["B"], view.answers.map((item) => item.displayName)),
    check("a friend ask offers no meeting", false, answer?.canMeet),
    check("B gets a copy with A's name", [{ mode: "react", text: REACT_ASK_TEXT, askerName: "A" }], await readCopiesOfB(run)),
  ];
  const isVerified = answer?.claims.some((claim) => claim.verified) ?? false;
  if (run.options.mode === "mock" || isVerified) assertions.push(check("the answer has a verified quote", true, isVerified));
  else notes.push("the answer has no verified quote (not exercised: model choice)");
  return finishStep(20, "friend-ask", { rows: ["P3", "P4", "design section 9"], detail: [`friend ask ${view.state}`, ...notes].join("; "), assertions });
}

// Step 21: A asks the directory for help. B's persona, the only listing, answers from public items only; a signed answer is placed
// first with a verified, supported quote. B's copies now hold both answers.
export async function step21Help(run: RunState): Promise<StepResult> {
  const personA = need(run.ids.personA, "personA");
  const publicTurns = need(run.facts.publicTurnIdsB, "publicTurnIdsB");
  const created = await run.a.json({ method: "POST", path: routes.asks.createAsk.path, body: { mode: "help", text: HELP_ASK_TEXT }, expect: 201, schema: routes.asks.createAsk.response });
  const askId = created.body.askId;
  run.ids.helpAskId = askId;
  const view = await waitForAsk(run.a, askId);
  const answer = view.answers[0];
  const answerTurns = await readAnswerTurnIds(run.db, personA, askId);
  const copies = await readCopiesOfB(run);
  const assertions: Assertion[] = [
    check("the help search is done", "done", view.state),
    check("B's persona answers, the only listing", ["B"], view.answers.map((item) => item.displayName)),
    check("the answer carries B's listing line", LISTING_LINE, answer?.line),
    check("every quote of the answer comes from a turn behind a public item", true, answerTurns.every((turnId) => publicTurns.includes(turnId))),
    check("B's copies hold both answers, each with A's name", [["help", "A"], ["react", "A"]], copies.map((copy) => [copy.mode, copy.askerName]).sort()),
  ];
  // Whether B's persona signs its answer is the model's choice. The recorded persona said B's public items show nothing on the question,
  // so --mock tolerates an unsigned answer as a live run does; a signed answer must still lead and offer a meeting.
  const notes: string[] = [];
  if (answer?.hasSign === true) {
    assertions.push(
      check("B's signed answer is placed first", 1, answer.position),
      check("B's answer has a verified, supported quote", true, answer.claims.some((claim) => claim.verified && claim.supported === true)),
      check("A can meet B from the results", true, answer.canMeet),
    );
  } else notes.push("B's persona gave no signed answer (not exercised: model choice)");
  run.manual.push(`the results read "${HELP_RESULTS_HEADING}" and show no number about a person (design section 10)`);
  return finishStep(21, "help", { rows: ["P5", "P6", "P7", "design section 9"], detail: [`help search ${view.state}; ${String(view.answers.length)} answer(s)`, ...notes].join("; "), assertions });
}
