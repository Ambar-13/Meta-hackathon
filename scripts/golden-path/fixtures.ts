// The paths, the fixed values and the loaders of the two people fixtures: A's pasted notes and B's ChatGPT export.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATARS, type SourceHeader, type Turn } from "@meet-first/contracts";
import { PARSER_VERSION, extractOwnTurns } from "@meet-first/parsers";
import { SCRUB_VERSION, scrub } from "@meet-first/scrub";
import { ExitError } from "./report.js";

// The folder the fixtures come from when GOLDEN_PATH_FIXTURES is not set, relative to the repository root.
export const DEFAULT_FIXTURE_FOLDER = "packages/evals/fixtures/people";
// A's notes, pasted as blocks of text, one block per turn.
export const PASTE_FIXTURE = "notes.paste.txt";
// B's export, in the ChatGPT 2024 mapping shape.
export const CHATGPT_FIXTURE = "alice.chatgpt.json";
// The one third-party name in A's notes. The names pass must replace it.
export const FIXTURE_NAME = "Rohan Mehta";
// The one email address in A's notes. The regex scrub must replace it.
export const FIXTURE_EMAIL = "rohan.mehta@example.com";
// The human answer the removed ask step would have sent. Kept with its value for the record.
export const ANSWER_TEXT = "golden path answer: Tuesday evenings only";
// The expiry text the removed ask step would have shown. Kept with its value for the record.
export const EXPIRY_TEXT = "my human is away, going with what I know";
// The curated question both people pick: question 1, a get-along question.
export const QUESTION_ID = 1;
// The seq at which reader A's connection is cut on purpose, so the replay after it is tested (step 8). Seq 10 falls in the first
// half of the recorded meeting's 28 events, so the meeting is still running when the stream resumes and when step 11 closes it.
export const PLANNED_DISCONNECT_SEQ = 10;
// The free-text question the question check must allow, a help question. It starts a second meeting that is never started.
export const FREE_TEXT_QUESTION = "Where could each of us help the other most on a 10-day hackathon?";
// The avatar B picks for the comic, the first of the fixed list.
export const AVATAR = AVATARS[0];
// How many of B's items B makes public in step 16: three, because the brief writer needs three distinct quotes of a side to fill
// a brief's nine lines, and in the directory meeting B's side may quote only public items.
export const PUBLIC_ITEM_COUNT = 3;
// The words of B's item that the help search of step 21 must find. Step 16 always makes this item public.
export const HELP_ITEM_WORDS = "When I feel stuck";
// The line B lists their persona with.
export const LISTING_LINE = "Plans the week on Sunday and likes one clear owner for every task.";
// The curated question A puts to B's listed persona: question 13, a debate.
export const DIRECTORY_QUESTION_ID = 13;
// A curated dating question, 17. B's listing refuses it, because B leaves the dating switch off.
export const ROMANCE_QUESTION_ID = 17;
// The friend ask A sends about B in step 20. apps/worker/src/asks/testing/golden-path-asks.ts writes its replies for the same text.
export const REACT_ASK_TEXT = "How would you probably react if the team moved the demo day to a Saturday?";
// What A types to the orchestrator in step 23: the question of step 20, quoted, so the plan carries it word for word and its ask
// replays step 20's recorded replies. Meety's own reply (prompt orchestrator v3) was recorded live on 3 Nov 2026.
export const ORCHESTRATOR_MESSAGE = `Can you ask B: "${REACT_ASK_TEXT}"`;
// The help search A sends in step 21; its words meet B's public item about getting stuck. golden-path-asks.ts uses the same text.
export const HELP_ASK_TEXT = "I keep getting stuck on one hard problem and go round in circles. Who could help me think it through?";
// The consent sentence the phone gate reads on screen before any upload. The script cannot see the screen.
export const CONSENT_COPY = "Your original archive stays on your device. After you review redactions, we upload and store only the selected excerpts shown here. You can delete them at any time.";

// One fixture made ready for the upload: its turns, its header, its NDJSON body, and the redactions the browser preview would show.
export type LoadedSource = { header: SourceHeader; turns: Turn[]; ndjson: string; previewRedactions: number };
// Both fixtures, loaded once at the start of a run.
export type LoadedFixtures = { paste: LoadedSource; chatgpt: LoadedSource };

// The folder the fixtures are read from: GOLDEN_PATH_FIXTURES when it is set, else the repository default.
export function fixtureFolder(): string {
  return process.env.GOLDEN_PATH_FIXTURES ?? DEFAULT_FIXTURE_FOLDER;
}

// Writes the NDJSON body (the header line, then one line per turn) and counts the redactions the browser preview would show.
export function buildNdjson(header: SourceHeader, turns: readonly Turn[]): { ndjson: string; previewRedactions: number } {
  const previewRedactions = turns.reduce((total, turn) => total + scrub(turn.text, { allowlist: [] }).redactions.length, 0);
  const ndjson = [JSON.stringify(header), ...turns.map((turn) => JSON.stringify(turn))].join("\n");
  return { ndjson, previewRedactions };
}

// Reads one fixture file, or exits 2 with its path when it is missing.
function readFixture(name: string): { path: string; text: string } {
  const path = join(fixtureFolder(), name);
  if (!existsSync(path)) throw new ExitError(2, `golden_path_fixture_missing: ${path}`);
  return { path, text: readFileSync(path, "utf8") };
}

// Parses one fixture with the parsers package and makes it into the upload parts. A fixture that does not parse exits 2.
function loadSource(name: string): LoadedSource {
  const { path, text } = readFixture(name);
  let extracted: ReturnType<typeof extractOwnTurns>;
  try {
    extracted = extractOwnTurns([{ name, text }], null);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown reason";
    throw new ExitError(2, `golden_path_fixture_missing: ${path} does not parse: ${reason}`);
  }
  if (extracted.turns.length === 0) throw new ExitError(2, `golden_path_fixture_missing: ${path} holds no turns written by its owner.`);
  const header: SourceHeader = {
    kind: extracted.kind,
    parserVersion: PARSER_VERSION,
    scrubVersion: SCRUB_VERSION,
    personaSignal: extracted.personaSignal,
    attested: true,
    turnCount: extracted.turns.length,
  };
  const { ndjson, previewRedactions } = buildNdjson(header, extracted.turns);
  return { header, turns: extracted.turns, ndjson, previewRedactions };
}

// Loads both fixtures. A missing or unreadable file exits 2 before any step runs.
export function loadFixtures(): LoadedFixtures {
  return { paste: loadSource(PASTE_FIXTURE), chatgpt: loadSource(CHATGPT_FIXTURE) };
}
