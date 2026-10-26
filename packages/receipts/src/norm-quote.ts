// Normalises text so a model's quote and the stored turn compare like with like (D24, R6.1).
// Steps, in order: NFC; case fold (toLowerCase after NFC); curly quotes and dashes to ASCII; runs of ASCII whitespace to one space;
// trim; then strip leading and trailing punctuation.

// The character map used by normQuote, exported so the offset map can replay it one character at a time.
export const QUOTE_FOLDS: ReadonlyMap<string, string> = new Map([
  ["\u2018", "'"], ["\u2019", "'"], ["\u201A", "'"], ["\u201B", "'"],
  ["\u201C", '"'], ["\u201D", '"'], ["\u201E", '"'], ["\u201F", '"'],
  ["\u2010", "-"], ["\u2011", "-"], ["\u2012", "-"], ["\u2013", "-"], ["\u2014", "-"], ["\u2015", "-"], ["\u2212", "-"],
]);
// Leading or trailing whitespace and punctuation, removed at both ends of a normalised quote (D24).
export const LEADING_TRAILING_PUNCTUATION = /^[\s\p{P}]+|[\s\p{P}]+$/gu;
// A run of ordinary spaces, tabs or line breaks, collapsed to one space (D24).
export const ASCII_WHITESPACE_RUN = /[ \t\n\r\f\v]+/g;
// A base character with the combining marks that follow it. NFC composes inside one cluster, so clusters are normalised alone.
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

// The normalised text and, for each of its UTF-16 code units, the index in the original text that produced it.
export type FoldedText = { normalised: string; sources: number[] };

// Runs the normalisation steps and keeps track of where each output code unit came from (D7).
export function foldQuote(text: string): FoldedText {
  let folded = "";
  const sources: number[] = [];
  for (const cluster of text.matchAll(CLUSTER)) {
    const start = cluster.index;
    for (const character of cluster[0].normalize("NFC").toLowerCase()) {
      const output = QUOTE_FOLDS.get(character) ?? character;
      folded += output;
      for (let unit = 0; unit < output.length; unit++) sources.push(start);
    }
  }
  const collapsed = collapseWhitespace(folded, sources);
  return stripEnds(collapsed.normalised, collapsed.sources);
}

// Replaces each run of ASCII whitespace with one space, taking the position of the first character of the run.
function collapseWhitespace(text: string, sources: readonly number[]): FoldedText {
  let normalised = "";
  const outSources: number[] = [];
  let cursor = 0;
  for (const run of text.matchAll(ASCII_WHITESPACE_RUN)) {
    const at = run.index;
    normalised += text.slice(cursor, at);
    outSources.push(...sources.slice(cursor, at));
    normalised += " ";
    outSources.push(sources[at] ?? 0);
    cursor = at + run[0].length;
  }
  normalised += text.slice(cursor);
  outSources.push(...sources.slice(cursor));
  return { normalised, sources: outSources };
}

// Drops the punctuation and spaces at both ends. The regex matches at the start and at the end, so each match is one or the other.
function stripEnds(text: string, sources: readonly number[]): FoldedText {
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(LEADING_TRAILING_PUNCTUATION)) {
    if (match.index === 0) start = match[0].length;
    else end = match.index;
  }
  return { normalised: text.slice(start, end), sources: sources.slice(start, end) };
}

// Normalises one text for comparison. The same function runs on the quote and on the stored turn.
export function normQuote(text: string): string {
  return foldQuote(text).normalised;
}
