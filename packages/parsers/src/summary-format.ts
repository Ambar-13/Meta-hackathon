import {
  SUMMARY_KINDS,
  SUMMARY_LINE_MAX_CHARS,
  SUMMARY_MAX_POINTS,
  SUMMARY_QUOTES_MAX,
  SUMMARY_TOPIC_MAX_CHARS,
  type SummaryKind,
  type SummaryPoint,
  type SummaryStrength,
} from "@meet-first/contracts";

// The quotes and topics of a summary, which the browser keeps first when it chooses what to send.
export type SummaryPriority = { quotes: string[]; topics: string[] };

// The fields a summary block may hold.
type Field = "kind" | "topic" | "point" | "strength" | "quote";
// One block while it is read: its fields so far.
type Draft = { kind?: string; topic?: string; point?: string; strength?: string; quotes: string[] };

// A field line after any bullets (hyphens, en or em dashes, dots), numbers, quote markers or bold
// around the field name, with an optional number after it: "1. **Kind:** view", "- point: ...",
// "Quote 2: ...", "Quote #3: ...".
const FIELD_LINE =
  /^[\s>*•\-\u2013\u2014\d.)]*(?:\*\*|__)?(kind|topic|point|strength|quote)(?:\s*#?\d+)?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;
// Quote marks that may wrap a value, each opener with its closer.
const WRAPPERS: ReadonlyArray<[string, string]> = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
  ["`", "`"],
];
// The kinds as a set, for a quick check.
const KINDS: ReadonlySet<string> = new Set(SUMMARY_KINDS);
// The strengths, in the words the copy prompt asks for.
const STRENGTHS: ReadonlySet<string> = new Set(["strong", "moderate", "mild"]);

// A value with bold markers at its end and one pair of wrapping quote marks removed.
function cleanValue(raw: string): string {
  const value = raw.replace(/(?:\*\*|__)\s*$/, "").trim();
  const wrapper = WRAPPERS.find(
    ([open, close]) => value.length >= 2 && value.startsWith(open) && value.endsWith(close),
  );
  return (wrapper === undefined ? value : value.slice(1, -1)).trim();
}

// A text cut to at most max characters, never splitting a character in two.
function cutTo(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

// The point a finished block makes, or null when it has no point. The strength is its first word,
// so a note after it is ignored.
function pointOf(draft: Draft): SummaryPoint | null {
  const point = cutTo(draft.point ?? "", SUMMARY_LINE_MAX_CHARS);
  if (point === "") return null;
  const kind = (draft.kind ?? "").toLowerCase();
  const strength = /^[a-z]+/.exec((draft.strength ?? "").toLowerCase())?.[0] ?? "";
  return {
    kind: (KINDS.has(kind) ? kind : "other") as SummaryKind,
    topic: cutTo(draft.topic ?? "", SUMMARY_TOPIC_MAX_CHARS),
    point,
    strength: (STRENGTHS.has(strength) ? strength : "moderate") as SummaryStrength,
    quotes: draft.quotes
      .filter((quote) => quote !== "")
      .slice(0, SUMMARY_QUOTES_MAX)
      .map((quote) => cutTo(quote, SUMMARY_LINE_MAX_CHARS)),
  };
}

// True when a field starts a new block: a kind or a point arriving after the block already has a
// point.
function startsNewBlock(draft: Draft, field: Field): boolean {
  return (field === "kind" || field === "point") && draft.point !== undefined;
}

// The blocks of a summary, each as its fields. A blank line ends a block, and so does a new kind or
// point after a point.
function readDrafts(text: string): Draft[] {
  const drafts: Draft[] = [];
  let draft: Draft = { quotes: [] };
  const finish = (): void => {
    if (draft.point !== undefined || draft.kind !== undefined) drafts.push(draft);
    draft = { quotes: [] };
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      finish();
      continue;
    }
    const match = FIELD_LINE.exec(line);
    if (match === null) continue;
    const field = (match[1] ?? "").toLowerCase() as Field;
    if (startsNewBlock(draft, field)) finish();
    const value = cleanValue(match[2] ?? "");
    if (field === "quote") draft.quotes.push(value);
    else draft[field] = value;
  }
  finish();
  return drafts;
}

// The points of a summary written in the copy prompt's format, at most SUMMARY_MAX_POINTS. Lines
// that are not fields are ignored, so an AI's opening sentence or headings do no harm; text with no
// point gives an empty list.
export function parseSummary(text: string): SummaryPoint[] {
  return readDrafts(text)
    .map(pointOf)
    .filter((point): point is SummaryPoint => point !== null)
    .slice(0, SUMMARY_MAX_POINTS);
}

// Every quote of the points in order, and every topic once, in the order it first appears, ignoring
// case.
export function summaryPriority(points: readonly SummaryPoint[]): SummaryPriority {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const point of points) {
    const key = point.topic.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    topics.push(point.topic.trim());
  }
  return { quotes: points.flatMap((point) => point.quotes), topics };
}

// The points written back in the copy prompt's format: one block per point with its fields in
// order, a blank line between blocks, and no Topic or Quote line where the point has none.
// parseSummary reads the same points from it.
export function formatSummary(points: readonly SummaryPoint[]): string {
  return points
    .map((point) =>
      [
        `Kind: ${point.kind}`,
        ...(point.topic === "" ? [] : [`Topic: ${point.topic}`]),
        `Point: ${point.point}`,
        `Strength: ${point.strength}`,
        ...point.quotes.map((quote) => `Quote: ${quote}`),
      ].join("\n"),
    )
    .join("\n\n");
}
