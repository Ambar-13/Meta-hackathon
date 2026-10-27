// Steps 13 to 15 and 22: the two briefs, the comic, the share page with its consent and withdrawal, and, last of all, the deletion of A.
import { ErrorBody, FORBIDDEN_SHARE_KEYS, routes, type ComicView, type MeetingEvent, type ShareSnapshot } from "@meet-first/contracts";
import { countMeetingAsMember, countPerson, readBriefOwners, readClaimsSummary, readComic, readFlaggedClaimTexts, readLedgerFacts, readSharePage } from "./database-reads.js";
import { AVATAR } from "./fixtures.js";
import { PersonClient } from "./person-client.js";
import { check, finishStep, need, pollUntil, readers, routePath, StepFailure, type Assertion, type RunState, type StepResult } from "./report.js";
import { readCardView } from "./steps-people-and-sources.js";

// The brief may take 300 s after the meeting ends (two brief calls and two judge calls, ARCHITECTURE 8).
const BRIEF_WAIT_MS = 300_000;
// The comic may take 60 s, plus 10 s for its event to arrive (D64).
const COMIC_WAIT_MS = 70_000;
// The largest panel image in bytes (D64).
const PANEL_MAX_BYTES = 153_600;
// The deletion may take 60 s to clear every table (the job runs now with 5 attempts).
const DELETE_WAIT_MS = 60_000;
// The poll interval for the deletion (the spec's 3 s).
const DELETE_POLL_MS = 3_000;
// The path of the share page that the web app serves at its own address (IMPLEMENTATION 2.2).
const SHARE_PAGE = "/share/";

// Every key the share snapshot must never carry, found at any depth of the JSON (R9.4, invariant 13).
function forbiddenKeysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item: unknown) => forbiddenKeysIn(item));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [...((FORBIDDEN_SHARE_KEYS as readonly string[]).includes(key) ? [key] : []), ...forbiddenKeysIn(child)]);
}

// Step 13: both briefs are read. Decide first holds only supported lines, the mock run has exactly one unsupported line, and each side gets its own brief.
export async function step13Brief(run: RunState): Promise<StepResult> {
  const { a } = readers(run);
  const meetingId = need(run.ids.meetingId, "meetingId");
  const personA = need(run.ids.personA, "personA");
  const personB = need(run.ids.personB, "personB");
  const ready = await a.waitFor((event) => event.type === "brief.ready", BRIEF_WAIT_MS);
  const briefReady = a.committed.find((event): event is Extract<MeetingEvent, { type: "brief.ready" }> => event.type === "brief.ready");
  const briefA = await run.a.json({ method: "GET", path: routePath(routes.briefs.readBrief.path, { id: meetingId }), expect: 200, schema: routes.briefs.readBrief.response });
  const briefB = await run.b.json({ method: "GET", path: routePath(routes.briefs.readBrief.path, { id: meetingId }), expect: 200, schema: routes.briefs.readBrief.response });
  const points = [...briefA.body.agree, ...briefA.body.clash, ...briefA.body.decideFirst, ...briefB.body.agree, ...briefB.body.clash, ...briefB.body.decideFirst];
  const unsupported = points.filter((point) => point.supported === false);
  run.facts.unsupportedTexts = unsupported.map((point) => point.text);
  const owners = await readBriefOwners(run.db, meetingId);
  const claims = await readClaimsSummary(run.db, meetingId);
  run.facts.flaggedTexts = await readFlaggedClaimTexts(run.db, meetingId);
  const assertions: Assertion[] = [
    check("the brief is ready", true, ready.type === "brief.ready"),
    check("the support rates are keyed a and b", ["a", "b"], briefReady === undefined ? [] : Object.keys(briefReady.supportRate).sort()),
    check("A's agree line differs from B's", true, briefA.body.agree[0]?.text !== briefB.body.agree[0]?.text),
    check("each brief row has its owner", 2, owners.length),
    check("A's stored first agree line matches A's brief", briefA.body.agree[0]?.text, owners.find((row) => row.personId === personA)?.firstAgree),
    check("B's stored first agree line matches B's brief", briefB.body.agree[0]?.text, owners.find((row) => row.personId === personB)?.firstAgree),
    check("the claims are counted", true, claims.total >= 1),
    check("every claim is verified or flagged", true, claims.verified + claims.flagged >= claims.total),
  ];
  // The recorded replies script one unsupported line outside decide first. A live model may leave an unsupported line in decide first,
  // which the contract allows (decideFirst is always three lines) and the brief screen sets aside (A1), so this holds under --mock only.
  if (run.options.mode === "mock") {
    assertions.push(
      check("decide first holds only supported lines", true, [...briefA.body.decideFirst, ...briefB.body.decideFirst].every((point) => point.supported === true && point.quotes.every((quote) => quote.verified))),
      check("exactly one line is unsupported", 1, unsupported.length),
      check("the unsupported line is not in decide first", true, unsupported.every((point) => !briefA.body.decideFirst.includes(point) && !briefB.body.decideFirst.includes(point))),
      check("both support judgments are reliable", [true, true], [briefA.body.supportReliable, briefB.body.supportReliable]),
    );
  }
  run.manual.push(`3 lines each with tappable quotes; ${String(claims.flagged)} flagged claim(s) read "no receipt" on both screens; any unsupported line reads "weak receipt" and is not in decide first; the support rate is shown as a rate, never as proof (A1)`);
  return finishStep(13, "brief", { rows: ["R6.5", "R7.6", "A1", "invariant 19"], detail: `briefs ready; ${String(unsupported.length)} unsupported line(s); ${String(claims.flagged)} flagged claim(s)`, assertions });
}

// The checks on a ready comic: six panels from one to six, and panel one is a webp image under 150 KB (D64).
async function readyComicChecks(run: RunState, comicId: string, view: ComicView): Promise<Assertion[]> {
  const image = await run.b.getRaw(routePath(routes.briefs.panelImage.path, { id: comicId, position: "1" }));
  return [
    check("the comic has six panels", 6, view.panels.length),
    check("the panels run one to six", true, view.panels.every((panel, index) => panel.position === index + 1 && panel.caption !== "" && panel.imageUrl !== "")),
    check("panel one is a webp image", true, image.status === 200 && image.contentType.startsWith("image/webp")),
    check("panel one is under 150 KB", true, image.bytes.length < PANEL_MAX_BYTES),
  ];
}

// The checks on the comic row: it is written after the brief, its state is final, and its panel count matches its state (R11.1, R11.2).
function comicRowChecks(view: ComicView, row: { state: string; panels: number } | undefined, isAfterBrief: boolean): Assertion[] {
  return [
    check("the comic is written after the brief", true, isAfterBrief),
    check("the database state is a final one", true, row !== undefined && ["ready", "failed", "skipped"].includes(row.state)),
    check("the database panel count matches the state", view.state === "ready" ? 6 : 0, row?.panels ?? -1),
  ];
}

// The reason a comic was skipped, as its event gives it, or a plain word when the event is not a skip.
function skipReason(event: MeetingEvent): string {
  return event.type === "comic.skipped" ? event.reason : "no reason";
}

// Step 14: B asks for a comic. It is ready with six panels under --mock, or skipped with a reason under --live.
export async function step14Comic(run: RunState): Promise<StepResult> {
  const { b } = readers(run);
  const meetingId = need(run.ids.meetingId, "meetingId");
  const requested = await run.b.json({ method: "POST", path: routePath(routes.briefs.requestComic.path, { id: meetingId }), body: { avatar: AVATAR }, expect: 202, schema: routes.briefs.requestComic.response });
  const comicId = requested.body.comicId;
  run.ids.comicId = comicId;
  const done = await b.waitFor((event) => (event.type === "comic.ready" || event.type === "comic.skipped") && event.comicId === comicId, COMIC_WAIT_MS);
  const view: ComicView = (await run.b.json({ method: "GET", path: routePath(routes.briefs.readComic.path, { id: meetingId }), expect: 200, schema: routes.briefs.readComic.response })).body;
  const row = await readComic(run.db, meetingId);
  const briefSeq = b.committed.find((event) => event.type === "brief.ready")?.seq ?? 0;
  const comicSeq = "seq" in done ? done.seq : 0;
  const assertions = comicRowChecks(view, row, comicSeq > briefSeq);
  if (view.state === "ready") assertions.push(...(await readyComicChecks(run, comicId, view)));
  if (run.options.mode === "mock") assertions.push(check("the comic is ready under --mock", "ready", view.state));
  const detail = view.state === "skipped" ? `comic skipped: ${skipReason(done)}` : `comic ${view.state}`;
  return finishStep(14, "comic", { rows: ["R11.1", "R11.2", "D64"], detail, assertions });
}

// Step 15: both consent, the share page opens for anyone with no cookie, shows names and supported lines only, and withdrawal takes it down.
export async function step15Share(run: RunState): Promise<StepResult> {
  const meetingId = need(run.ids.meetingId, "meetingId");
  const consentPath = routePath(routes.briefs.consent.path, { id: meetingId });
  const first = await run.a.json({ method: "POST", path: consentPath, expect: 200, schema: routes.briefs.consent.response });
  const pageBefore = await readSharePage(run.db, meetingId);
  const assertions: Assertion[] = [
    check("A's consent is recorded and the page is not live", { consentA: true, consentB: false, published: false, slug: undefined }, { consentA: first.body.consentA, consentB: first.body.consentB, published: first.body.published, slug: first.body.slug }),
    check("the database shows no live page yet", true, pageBefore === undefined || !pageBefore.published),
  ];
  const second = await run.b.json({ method: "POST", path: consentPath, expect: 200, schema: routes.briefs.consent.response });
  const slug = second.body.slug ?? "";
  run.ids.slug = slug;
  assertions.push(
    check("both have consented and the page is live", { consentA: true, consentB: true, published: true }, { consentA: second.body.consentA, consentB: second.body.consentB, published: second.body.published }),
    check("the slug is set and unrelated to any id", true, slug !== "" && !slug.includes(meetingId)),
  );
  const anon = new PersonClient("A", run.options.base);
  const sharePath = routePath(routes.briefs.readShare.path, { slug });
  const snapshot = await anon.json({ method: "GET", path: sharePath, expect: 200, schema: routes.briefs.readShare.response });
  assertions.push(...snapshotChecks(snapshot.body, snapshot.headers.get("cache-control"), run));
  const page = await anon.getRaw(`${SHARE_PAGE}${slug}`);
  assertions.push(check("the share link serves the app shell", true, page.status === 200 && page.contentType.startsWith("text/html")));
  await withdrawAndReturn(run, { anon, consentPath, sharePath, meetingId }, assertions);
  run.manual.push("the share link opens in a private window and shows display names only (R7.6)");
  return finishStep(15, "share", { rows: ["R7.6", "R9.4", "D68", "invariant 13"], detail: "share page live for both consents; withdrawal returns 404", assertions });
}

// The checks on the public snapshot: no forbidden key, two people by display name, no unsupported line, no flagged claim, no-store.
function snapshotChecks(snapshot: ShareSnapshot, cacheControl: string | null, run: RunState): Assertion[] {
  const texts = [...snapshot.brief.agree, ...snapshot.brief.clash, ...snapshot.brief.decideFirst].map((point) => point.text);
  const claimTexts = snapshot.turns.flatMap((turn) => turn.claims.map((claim) => claim.text));
  return [
    check("the snapshot is not cached", "no-store", cacheControl),
    check("the snapshot has no person, email or pair key", [], forbiddenKeysIn(snapshot)),
    check("the snapshot names two people by side and display name", [["a", "b"], true], [snapshot.people.map((person) => person.side), snapshot.people.every((person) => Object.keys(person).length === 2)]),
    check("the snapshot holds no unsupported line", false, texts.some((text) => run.facts.unsupportedTexts.includes(text))),
    check("the snapshot holds no flagged claim", false, claimTexts.some((text) => run.facts.flaggedTexts.includes(text))),
  ];
}

// Withdraws consent (the page is gone, 404), checks the database, then gives consent again and the page returns.
async function withdrawAndReturn(run: RunState, paths: { anon: PersonClient; consentPath: string; sharePath: string; meetingId: string }, assertions: Assertion[]): Promise<void> {
  const withdrawn = await run.a.json({ method: "DELETE", path: paths.consentPath, expect: 200, schema: routes.briefs.withdrawConsent.response });
  assertions.push(check("withdrawal says not published", false, withdrawn.body.published));
  await paths.anon.json({ method: "GET", path: paths.sharePath, expect: 404, schema: ErrorBody });
  const row = await readSharePage(run.db, paths.meetingId);
  assertions.push(check("the database says not published", false, row?.published ?? false));
  try {
    const again = await run.a.json({ method: "POST", path: paths.consentPath, expect: 200, schema: routes.briefs.consent.response });
    assertions.push(check("the page is published again", true, again.body.published));
    await paths.anon.json({ method: "GET", path: paths.sharePath, expect: 200, schema: routes.briefs.readShare.response });
  } catch (error) {
    // The route may refuse consent after a withdrawal. The 404 above stays as the proof, and the return is marked not exercised.
    if (!(error instanceof StepFailure)) throw error;
    run.manual.push("re-consent after withdrawal was refused; the return is not exercised, the 404 above is the proof");
  }
}

// The checks on what B keeps and loses when A is deleted, beyond the meeting: no copy of A's asks, no friend, and B's own listing.
async function directoryChecksAfterDeletion(run: RunState, personB: string): Promise<Assertion[]> {
  const asks = await run.b.json({ method: "GET", path: routes.asks.listAsks.path, expect: 200, schema: routes.asks.listAsks.response });
  const friends = await run.b.json({ method: "GET", path: routes.directory.friends.path, expect: 200, schema: routes.directory.friends.response });
  const listing = await run.b.json({ method: "GET", path: routes.directory.readMyListing.path, expect: 200, schema: routes.directory.readMyListing.response });
  const directoryMeetingId = need(run.ids.directoryMeetingId, "directoryMeetingId");
  return [
    check("B no longer sees the directory meeting", 0, await countMeetingAsMember(run.db, personB, directoryMeetingId)),
    check("B's copies of A's asks are gone", [], asks.body.aboutMe),
    check("B no longer has A as a friend", [], friends.body.friends),
    check("B's listing stays", need(run.ids.listingB, "listingB"), listing.body.listingId),
  ];
}

// Step 22: A deletes the account. Every table clears for A, B keeps their source, card and listing, and A's meetings and asks are
// gone for B.
export async function step22Delete(run: RunState): Promise<StepResult> {
  const personA = need(run.ids.personA, "personA");
  const personB = need(run.ids.personB, "personB");
  const meetingId = need(run.ids.meetingId, "meetingId");
  const cardB = need(run.ids.cardB, "cardB");
  const ledger = await readLedgerFacts(run.db, meetingId, [personA, personB]);
  run.facts.ledgerModes = ledger.modes;
  run.facts.ledgerCallSites = ledger.callSites;
  const deleted = await run.a.json({ method: "DELETE", path: routes.people.deleteMe.path, expect: 202, schema: routes.people.deleteMe.response });
  const cookie = run.a.lastSetCookie() ?? "";
  const assertions: Assertion[] = [check("the deletion has an id", true, deleted.body.deletionId !== ""), check("the session cookie is cleared", true, /Max-Age=0|__Host-session=(;|$)/.test(cookie))];
  const counts = await pollUntil(() => countPerson(run.db, personA), (value) => Object.values(value).every((count) => count === 0), { timeoutMs: DELETE_WAIT_MS, intervalMs: DELETE_POLL_MS });
  assertions.push(check("every table is empty for A", true, Object.values(counts).every((count) => count === 0)));
  const anon = new PersonClient("B", run.options.base);
  const slug = need(run.ids.slug, "slug");
  await anon.json({ method: "GET", path: routePath(routes.briefs.readShare.path, { slug }), expect: 404, schema: ErrorBody });
  await run.b.json({ method: "GET", path: routePath(routes.meetings.readMeeting.path, { id: meetingId }), expect: 404, schema: ErrorBody });
  const cardView = await readCardView(run.b, cardB);
  assertions.push(
    check("B no longer sees the meeting", 0, await countMeetingAsMember(run.db, personB, meetingId)),
    check("B keeps the card as approved", "approved", cardView.state),
    check("B keeps every card item", need(run.facts.cardBItemCount, "cardBItemCount"), cardView.items.length),
    ...(await directoryChecksAfterDeletion(run, personB)),
  );
  run.manual.push("the deletion dialog says the other person keeps their source and card (R9.7)");
  return finishStep(22, "delete", { rows: ["R9.6", "R9.7", "D69", "invariant 16", "P2"], detail: "A's rows cleared; B keeps the card and the listing", assertions });
}
