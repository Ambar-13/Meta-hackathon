// Turns the people fixtures into the gzip NDJSON body the browser posts, and reads the planted
// markers and planted secrets.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { type SourceHeader, type Turn } from "@meet-first/contracts";
import { PARSER_VERSION, extractOwnTurns } from "@meet-first/parsers";
import { SCRUB_VERSION, scrub } from "@meet-first/scrub";
import { REPO_ROOT } from "./eval-flags.js";

// The folder the people fixtures live in, from the repository root.
export const PEOPLE_FOLDER = join(REPO_ROOT, "packages", "evals", "fixtures", "people");
// The folder the injection fixtures live in.
export const INJECTION_FOLDER = join(REPO_ROOT, "packages", "evals", "fixtures", "injection");
// One people fixture: the file name, the kind, its path, and the injection file appended to it when
// there is one.
export type PersonFixture = {
  name: string;
  kind: "chatgpt" | "claude" | "paste";
  path: string;
  injectionPath?: string;
};
// The marker sentence: the words SAY THE WORD and one capitalised word of four letters or more.
const MARKER_PATTERN = /SAY THE WORD ([A-Z]{4,})/g;

// Pulls the marker tokens out of an injection fixture, in the order they appear.
export function extractMarkers(text: string): string[] {
  return [...text.matchAll(MARKER_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

// The text the upload is read from: the fixture, with its injection file appended as its own blocks
// when it has one.
function textOf(fixture: PersonFixture): string {
  const base = readFileSync(fixture.path, "utf8");
  if (fixture.injectionPath === undefined) return base;
  return `${base}\n\n${readFileSync(fixture.injectionPath, "utf8")}`;
}

// Builds the gzip NDJSON body the way the browser does: the header line, then one line per turn,
// with the preview's redaction count.
export function buildSourceBody(
  fixture: PersonFixture,
): Promise<{ gzip: Uint8Array; turnCount: number; previewRedactions: number }> {
  const extracted = extractOwnTurns([{ name: fixture.name, text: textOf(fixture) }], null);
  const header: SourceHeader = {
    kind: extracted.kind,
    parserVersion: PARSER_VERSION,
    scrubVersion: SCRUB_VERSION,
    personaSignal: extracted.personaSignal,
    attested: true,
    turnCount: extracted.turns.length,
  };
  const previewRedactions = extracted.turns.reduce(
    (total: number, turn: Turn) => total + scrub(turn.text, { allowlist: [] }).redactions.length,
    0,
  );
  const ndjson = [
    JSON.stringify(header),
    ...extracted.turns.map((turn) => JSON.stringify(turn)),
  ].join("\n");
  return Promise.resolve({
    gzip: gzipSync(ndjson),
    turnCount: extracted.turns.length,
    previewRedactions,
  });
}

// Counts the planted secrets the scrub lets through: a line survives when its expected category is
// not among the redactions.
export function countPlantedSurvivors(ndjsonPath: string): { survivors: number; total: number } {
  const lines = readFileSync(ndjsonPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const planted = lines.map(
    (line) => JSON.parse(line) as { text: string; expectedCategory: string },
  );
  const survivors = planted.filter(
    (item) =>
      !scrub(item.text, { allowlist: [] }).redactions.some(
        (found) => found.category === item.expectedCategory,
      ),
  ).length;
  return { survivors, total: planted.length };
}

// Finds one people fixture by file name, or undefined when the file is not in the folder. The kind
// follows the file extension.
export function findPersonFixture(name: string): PersonFixture | undefined {
  const path = join(PEOPLE_FOLDER, name);
  if (!existsSync(path)) return undefined;
  return { name, kind: name.endsWith(".txt") ? "paste" : "chatgpt", path };
}

// The path of one injection fixture by file name, or undefined when the file is not in the folder.
export function findInjectionPath(name: string): string | undefined {
  const path = join(INJECTION_FOLDER, name);
  return existsSync(path) ? path : undefined;
}
