// Steps 1 to 4: two people, A's pasted notes and B's ChatGPT export, each made into a source,
// redacted and given a card.
import {
  CARD_ITEMS_MIN,
  CardView,
  ErrorBody,
  RecoverResponse,
  SESSION_COOKIE,
  routes,
} from "@meet-first/contracts";
import {
  countPlaceholders,
  countRedactions,
  countSessions,
  countItemsOutsideSource,
  countTurnsContaining,
  readCard,
  readSource,
} from "./database-reads.js";
import { CONSENT_COPY, FIXTURE_EMAIL, FIXTURE_NAME } from "./fixtures.js";
import type { PersonClient } from "./person-client.js";
import {
  check,
  finishStep,
  need,
  pollUntil,
  routePath,
  type Assertion,
  type RunState,
  type StepResult,
} from "./report.js";

// The names pass is read every 3 seconds (the spec's poll interval for a source).
const NAMES_POLL_MS = 3_000;
// The names pass may take 60 s for the paste and 120 s for the export.
const NAMES_PASTE_TIMEOUT_MS = 60_000;
const NAMES_EXPORT_TIMEOUT_MS = 120_000;
// The card is due within 60 s for the paste, and within 300 s for the export (the card call's
// timeout plus a margin).
const CARD_PASTE_TIMEOUT_MS = 60_000;
const CARD_EXPORT_TIMEOUT_MS = 300_000;
// The card poll interval.
const CARD_POLL_MS = 3_000;
// The export must hold at least this many turns (IMPLEMENTATION 2.7) and at most this many.
const EXPORT_TURNS_MIN = 50;
const EXPORT_TURNS_MAX = 10_000;
// The compressed upload limit: 2 MiB.
const UPLOAD_COMPRESSED_LIMIT = 2_097_152;
// The words the script prints when a card has too few verified items.
const THIN_DETAIL =
  "card_thin: fewer than 6 verified items from the paste fixture; the fixture or the dossier prompt needs work";

// Reads the source view with its first page of names.
export async function readSourceView(client: PersonClient, sourceId: string) {
  const path = `${routePath(routes.sources.readSource.path, { id: sourceId })}?page=1`;
  const reply = await client.json({
    method: "GET",
    path,
    expect: 200,
    schema: routes.sources.readSource.response,
  });
  return reply.body;
}

// Reads one card with its items. The browser polls this every 3 seconds.
export async function readCardView(client: PersonClient, cardId: string) {
  const reply = await client.json({
    method: "GET",
    path: routePath(routes.cards.readCard.path, { id: cardId }),
    expect: 200,
    schema: routes.cards.readCard.response,
  });
  return reply.body;
}

// Sends the names review for a source and returns the reply. Every name in the list is kept or
// replaced by the decisions given.
async function sendNamesReview(
  client: PersonClient,
  sourceId: string,
  decisions: Array<{ text: string; keep: boolean }>,
) {
  const reply = await client.json({
    method: "POST",
    path: routePath(routes.sources.namesReview.path, { id: sourceId }),
    body: { decisions, sensitiveOptIn: [] },
    expect: 200,
    schema: routes.sources.namesReview.response,
  });
  return reply.body;
}

// Asks for a card on a source, waits until it is no longer building, and returns the card with its
// id.
async function buildCard(client: PersonClient, sourceId: string, timeoutMs: number) {
  const requested = await client.json({
    method: "POST",
    path: routePath(routes.sources.requestCard.path, { id: sourceId }),
    expect: 202,
    schema: routes.sources.requestCard.response,
  });
  const cardId = requested.body.cardId;
  const card = await pollUntil(
    () => readCardView(client, cardId),
    (view) => view.state !== "building",
    { timeoutMs, intervalMs: CARD_POLL_MS },
  );
  return { cardId, card };
}

// The checks every ready card must pass: ready, at least six verified items, none flagged, each
// with a quote and a turn.
function readyCardChecks(card: CardView, prefix: string): Assertion[] {
  const verified = card.items.filter((item) => item.verified).length;
  return [
    check(`${prefix} card is ready`, "ready", card.state),
    check(`${prefix} card has at least six items`, true, card.items.length >= CARD_ITEMS_MIN),
    check(
      `${prefix} card has at least six verified items`,
      true,
      (card.itemsVerified ?? 0) >= CARD_ITEMS_MIN,
    ),
    check(`${prefix} every item is verified`, true, card.items.length === verified),
    check(
      `${prefix} no item is flagged`,
      true,
      card.items.every((item) => !item.flagged),
    ),
    check(
      `${prefix} every item has a quote and a turn`,
      true,
      card.items.every((item) => item.quote !== "" && item.turnId !== ""),
    ),
  ];
}

// The sign-up body for one display name, with the access code when the site asks for one
// (ACCESS_CODE in the shell).
export function signUpBody(displayName: string): { displayName: string; accessCode?: string } {
  const accessCode = (process.env.ACCESS_CODE ?? "").trim();
  return accessCode === "" ? { displayName } : { displayName, accessCode };
}

// Step 1: two people with cookies and recovery codes; the Origin refusal; the single-use recovery
// code.
export async function step01Person(run: RunState): Promise<StepResult> {
  const created = routes.people.createPerson;
  const reply = await run.a.json({
    method: created.method,
    path: created.path,
    body: signUpBody("A"),
    expect: 201,
    schema: created.response,
  });
  const cookie = run.a.lastSetCookie() ?? "";
  const token = run.a.currentToken() ?? "";
  run.ids.personA = reply.body.personId;
  run.facts.recoveryCodeA = reply.body.recoveryCode;
  const assertions: Assertion[] = [
    check("recovery code is 32 characters", 32, reply.body.recoveryCode.length),
    check("cookie is __Host-session", true, cookie.startsWith(`${SESSION_COOKIE}=`)),
    check("cookie is HttpOnly", true, cookie.includes("HttpOnly")),
    check("cookie is Secure", true, cookie.includes("Secure")),
    check("cookie path is /", true, cookie.includes("Path=/")),
    check("cookie is SameSite=Lax", true, cookie.includes("SameSite=Lax")),
    check("cookie has no Domain attribute", false, cookie.includes("Domain=")),
    check(
      "the session token is not in the reply body",
      false,
      token !== "" && JSON.stringify(reply.body).includes(token),
    ),
    check(
      "the reply body has no token key",
      [],
      Object.keys(reply.body).filter((key) => ["token", "sessionToken", "session"].includes(key)),
    ),
  ];
  await run.a.json({
    method: created.method,
    path: created.path,
    body: signUpBody("C"),
    expect: 403,
    schema: ErrorBody,
    omitOrigin: true,
  });
  assertions.push(check("the refused call stored no cookie", undefined, run.a.lastSetCookie()));
  const second = await run.b.json({
    method: created.method,
    path: created.path,
    body: signUpBody("B"),
    expect: 201,
    schema: created.response,
  });
  run.ids.personB = second.body.personId;
  assertions.push(
    check(
      "B's cookie is HttpOnly and Secure",
      true,
      (run.b.lastSetCookie() ?? "").includes("HttpOnly") &&
        (run.b.lastSetCookie() ?? "").includes("Secure"),
    ),
  );
  const personA = need(run.ids.personA, "personA");
  const personB = need(run.ids.personB, "personB");
  assertions.push(
    check("A has one session", 1, await countSessions(run.db, personA)),
    check("B has one session", 1, await countSessions(run.db, personB)),
  );
  const recovered = await run.a.json({
    method: "POST",
    path: routes.people.recover.path,
    body: { code: reply.body.recoveryCode },
    expect: 200,
    schema: RecoverResponse,
  });
  assertions.push(
    check("recovery returns A's person", personA, recovered.body.personId),
    check("recovery sets a new cookie", true, run.a.lastSetCookie() !== undefined),
  );
  await run.a.json({
    method: "POST",
    path: routes.people.recover.path,
    body: { code: reply.body.recoveryCode },
    expect: 404,
    schema: ErrorBody,
  });
  return finishStep(1, "person", {
    rows: ["R9.2", "A5", "A7", "invariant 21"],
    detail: "A and B created with cookies; recovery code used once",
    assertions,
  });
}

// Step 2: A's notes uploaded, the names pass finished, the review frozen, and the rows checked in
// the database.
export async function step02Paste(run: RunState): Promise<StepResult> {
  const paste = run.fixtures.paste;
  const personA = need(run.ids.personA, "personA");
  const assertions: Assertion[] = [
    check("the paste holds at least one turn", true, paste.turns.length >= 1),
    check("the browser preview finds one redaction", 1, paste.previewRedactions),
  ];
  run.manual.push(`preview shows 1 redaction and the consent copy verbatim: "${CONSENT_COPY}"`);
  const upload = await run.a.uploadSource(paste.ndjson);
  const sourceId = upload.body.sourceId;
  run.ids.sourceA = sourceId;
  assertions.push(
    check("the first upload is not a duplicate", false, upload.body.duplicate),
    check("turn count matches the paste", paste.turns.length, upload.body.turnCount),
    check("the upload redacts one email", 1, upload.body.redactionCount),
  );
  const repeat = await run.a.uploadSource(paste.ndjson);
  assertions.push(
    check("a repeat upload returns the first id", sourceId, repeat.body.sourceId),
    check("a repeat upload is marked duplicate", true, repeat.body.duplicate),
  );
  const view = await pollUntil(
    () => readSourceView(run.a, sourceId),
    (value) => value.namesPassDone,
    { timeoutMs: NAMES_PASTE_TIMEOUT_MS, intervalMs: NAMES_POLL_MS },
  );
  assertions.push(
    check("the names pass has finished", true, view.namesPassDone),
    check("one name was found", 1, view.names.total),
    check("the name is preselected for replacement", false, view.names.rows[0]?.keep),
    check("the names page holds 20 rows", 20, view.names.pageSize),
    check("the found name is the fixture name", FIXTURE_NAME, view.names.rows[0]?.text),
  );
  const review = await sendNamesReview(run.a, sourceId, [{ text: FIXTURE_NAME, keep: false }]);
  run.facts.redactionsA = review.redactionCount;
  assertions.push(
    check("the review writes two redactions (email and name)", 2, review.redactionCount),
  );
  const source = await readSource(run.db, personA, sourceId);
  assertions.push(
    check("the source is frozen", true, source.frozen_at !== null),
    check("the names review is recorded", true, source.names_reviewed_at !== null),
    check(
      "the redaction rows match the review",
      review.redactionCount,
      await countRedactions(run.db, personA, sourceId),
    ),
    check(
      "no email is left in the turns",
      0,
      await countTurnsContaining(run.db, personA, { sourceId, needle: FIXTURE_EMAIL }),
    ),
    check(
      "no name is left in the turns",
      0,
      await countTurnsContaining(run.db, personA, { sourceId, needle: FIXTURE_NAME }),
    ),
    check("one placeholder is in the turns", 1, await countPlaceholders(run.db, personA, sourceId)),
  );
  return finishStep(2, "paste", {
    rows: ["R1.3", "R2.3", "R2.5", "A3", "D16"],
    detail: `sourceA frozen with ${String(review.redactionCount)} redactions`,
    assertions,
  });
}

// Step 3: A's card is built from the paste. Every item is verified, and no item quotes a turn
// outside the source.
export async function step03CardA(run: RunState): Promise<StepResult> {
  const personA = need(run.ids.personA, "personA");
  const sourceId = need(run.ids.sourceA, "sourceA");
  const { cardId, card } = await buildCard(run.a, sourceId, CARD_PASTE_TIMEOUT_MS);
  run.ids.cardA = cardId;
  const assertions = readyCardChecks(card, "A");
  assertions.push(
    check(
      "no item quotes another source",
      0,
      await countItemsOutsideSource(run.db, personA, { cardId, sourceId }),
    ),
    check("the card row is ready", "ready", (await readCard(run.db, personA, cardId)).state),
  );
  run.manual.push("each quote is tappable and highlights the source turn (R3.2)");
  const detail =
    card.state === "thin"
      ? THIN_DETAIL
      : `cardA ${card.state} with ${String(card.items.length)} items`;
  return finishStep(3, "card-a", { rows: ["R3.2", "R3.4"], detail, assertions });
}

// Step 4: B's ChatGPT export uploaded as a gzip body, its names reviewed, and its card built.
export async function step04UploadB(run: RunState): Promise<StepResult> {
  const chat = run.fixtures.chatgpt;
  const personB = need(run.ids.personB, "personB");
  const assertions: Assertion[] = [
    check("the export holds at least 50 turns", true, chat.turns.length >= EXPORT_TURNS_MIN),
    check("the export holds at most 10000 turns", true, chat.turns.length <= EXPORT_TURNS_MAX),
  ];
  const upload = await run.b.uploadSource(chat.ndjson);
  const sourceId = upload.body.sourceId;
  run.ids.sourceB = sourceId;
  assertions.push(
    check(
      "the compressed body is under 2 MiB",
      true,
      upload.compressedBytes < UPLOAD_COMPRESSED_LIMIT,
    ),
    check("the turn count matches the export", chat.turns.length, upload.body.turnCount),
    check("the first upload is not a duplicate", false, upload.body.duplicate),
  );
  const view = await pollUntil(
    () => readSourceView(run.b, sourceId),
    (value) => value.namesPassDone,
    { timeoutMs: NAMES_EXPORT_TIMEOUT_MS, intervalMs: NAMES_POLL_MS },
  );
  assertions.push(
    check("the names pass has finished", true, view.namesPassDone),
    check("the export has at least one name", true, view.names.total >= 1),
  );
  const decisions = view.names.rows.map((row) => ({ text: row.text, keep: false }));
  const review = await sendNamesReview(run.b, sourceId, decisions);
  run.facts.redactionsB = review.redactionCount;
  const source = await readSource(run.db, personB, sourceId);
  assertions.push(
    check("the source is frozen", true, source.frozen_at !== null),
    check(
      "the redaction rows match the review",
      review.redactionCount,
      await countRedactions(run.db, personB, sourceId),
    ),
  );
  const built = await buildCard(run.b, sourceId, CARD_EXPORT_TIMEOUT_MS);
  run.ids.cardB = built.cardId;
  run.facts.cardBItemCount = built.card.items.length;
  assertions.push(
    ...readyCardChecks(built.card, "B"),
    check(
      "no item quotes another source",
      0,
      await countItemsOutsideSource(run.db, personB, { cardId: built.cardId, sourceId }),
    ),
  );
  run.manual.push(
    "B picks the zip in the browser; the Web Worker reports the kept turn count; the zip path is proved on the phone gate (R1.1, D3)",
  );
  return finishStep(4, "upload-b", {
    rows: ["R1.1", "R1.4", "R3.2"],
    detail: `sourceB frozen; cardB ${built.card.state} with ${String(built.card.items.length)} items`,
    assertions,
  });
}
