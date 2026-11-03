import { createElement, type ReactElement } from "react";

// One run of inline text: plain, emphasis or strong.
export type SafeInline = { kind: "text" | "em" | "strong"; text: string };
// One block: a paragraph, a quote, or a list.
export type SafeBlock = { kind: "paragraph"; inlines: SafeInline[] } | { kind: "quote"; inlines: SafeInline[] } | { kind: "list"; isOrdered: boolean; items: SafeInline[][] };

// Star emphasis and strong only; everything else is left as typed.
const INLINE_PATTERN = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
// Lines that start a quote, an unordered item and an ordered item.
const QUOTE_LINE = /^ {0,3}> ?(.*)$/;
const UNORDERED_LINE = /^ {0,3}[-*+] +(.*)$/;
const ORDERED_LINE = /^ {0,3}\d{1,9}[.)] +(.*)$/;

// The block being built while the lines are read, or null between blocks.
type OpenBlock = { kind: "paragraph" | "quote"; lines: string[] } | { kind: "list"; isOrdered: boolean; items: string[] } | null;
// The finished blocks and the open block, as the line reader fills them.
type Parser = { blocks: SafeBlock[]; open: OpenBlock };

// Adds text to the inline runs, merging it into a neighbouring text run and skipping empty text.
function pushText(runs: SafeInline[], text: string): void {
  if (text === "") return;
  const last = runs.at(-1);
  if (last?.kind === "text") {
    last.text += text;
    return;
  }
  runs.push({ kind: "text", text });
}

// Splits one line of text into plain, emphasis and strong runs.
function inlinesOf(text: string): SafeInline[] {
  const runs: SafeInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index;
    pushText(runs, text.slice(last, index));
    if (match[1] !== undefined) runs.push({ kind: "strong", text: match[1] });
    else if (match[2] !== undefined) runs.push({ kind: "em", text: match[2] });
    last = index + match[0].length;
  }
  pushText(runs, text.slice(last));
  return runs;
}

// Turns the open block into a finished block and adds it to the list.
function closeBlock(parser: Parser): void {
  const open = parser.open;
  parser.open = null;
  if (open === null) return;
  if (open.kind === "list") {
    parser.blocks.push({ kind: "list", isOrdered: open.isOrdered, items: open.items.map(inlinesOf) });
    return;
  }
  parser.blocks.push({ kind: open.kind, inlines: inlinesOf(open.lines.join(" ")) });
}

// Adds a quote or paragraph line to the open block of that kind, or closes the open block and starts a new one.
function addTextLine(parser: Parser, kind: "paragraph" | "quote", text: string): void {
  const open = parser.open;
  if (open !== null && open.kind === kind) {
    open.lines.push(text);
    return;
  }
  closeBlock(parser);
  parser.open = { kind, lines: [text] };
}

// Adds a list item to the open list of the same kind, or closes the open block and starts a new list.
function addListItem(parser: Parser, item: { isOrdered: boolean; text: string }): void {
  const open = parser.open;
  if (open !== null && open.kind === "list" && open.isOrdered === item.isOrdered) {
    open.items.push(item.text);
    return;
  }
  closeBlock(parser);
  parser.open = { kind: "list", isOrdered: item.isOrdered, items: [item.text] };
}

// Reads one line into the parser: a blank line closes the block, and each other line joins or starts one.
function readLine(parser: Parser, line: string): void {
  if (/^\s*$/.test(line)) {
    closeBlock(parser);
    return;
  }
  const quote = QUOTE_LINE.exec(line);
  const unordered = UNORDERED_LINE.exec(line);
  const ordered = ORDERED_LINE.exec(line);
  if (quote !== null) {
    addTextLine(parser, "quote", quote[1] ?? "");
  } else if (unordered !== null) {
    addListItem(parser, { isOrdered: false, text: unordered[1] ?? "" });
  } else if (ordered !== null) {
    addListItem(parser, { isOrdered: true, text: ordered[1] ?? "" });
  } else {
    addTextLine(parser, "paragraph", line);
  }
}

// Parses model text into the allowed blocks; anything else, links, images and HTML included, stays literal text.
export function parseSafeMarkdown(text: string): SafeBlock[] {
  const parser: Parser = { blocks: [], open: null };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    readLine(parser, line);
  }
  closeBlock(parser);
  return parser.blocks;
}

// Builds the element for one run of inline text.
function renderInline(inline: SafeInline): string | ReactElement {
  if (inline.kind === "text") return inline.text;
  return createElement(inline.kind, null, inline.text);
}

// Builds the element for one block.
function renderBlock(block: SafeBlock): ReactElement {
  if (block.kind === "paragraph") return createElement("p", null, ...block.inlines.map(renderInline));
  if (block.kind === "quote") return createElement("blockquote", null, createElement("p", null, ...block.inlines.map(renderInline)));
  const items = block.items.map((item) => createElement("li", null, ...item.map(renderInline)));
  return createElement(block.isOrdered ? "ol" : "ul", null, ...items);
}

// Renders model text with p, blockquote, ul, ol, li, em and strong elements only, never as inner HTML.
export const SafeMarkdown = (props: { text: string }): ReactElement => {
  return createElement("div", { className: "safe-markdown" }, ...parseSafeMarkdown(props.text).map(renderBlock));
};
