// A structure check for the Mermaid diagrams written inside Markdown.
// This is not Mermaid's full grammar. The real parser needs the mermaid package and a browser page,
// and the repository installs neither. This check catches the mistakes that most often stop a diagram
// from drawing:
// - a diagram that is empty, or whose first line is not a known diagram type
// - a bracket or a quote left open, or a bracket closed that was never opened
// - a block (subgraph, alt, loop and the like) with no matching "end"
// - a mermaid fence that is never closed

/** One ```mermaid block: the Markdown line of its opening fence (from 1), its lines, and whether the fence closes. */
export type MermaidBlock = { fenceLine: number; lines: string[]; isClosed: boolean };

/** A problem in one diagram, with the Markdown line it is on. */
export type DiagramProblem = { line: number; message: string };

/** The diagram types these docs use, and the name each one is counted under. */
export const DIAGRAM_KINDS: ReadonlyMap<string, string> = new Map([
  ["flowchart", "flowchart"],
  ["graph", "flowchart"],
  ["sequenceDiagram", "sequenceDiagram"],
  ["stateDiagram", "stateDiagram"],
  ["stateDiagram-v2", "stateDiagram"],
  ["erDiagram", "erDiagram"],
  ["classDiagram", "classDiagram"],
]);

// Lines that open a block which must be closed by a line that says only "end".
const BLOCK_OPENERS: ReadonlyMap<string, RegExp> = new Map([
  ["flowchart", /^subgraph\b/],
  ["sequenceDiagram", /^(alt|opt|loop|par|critical|break|rect|box)\b/],
]);

// In these diagram types, the text after the first colon is free text, such as a message or a label.
const FREE_TEXT_AFTER_COLON: ReadonlySet<string> = new Set([
  "sequenceDiagram",
  "stateDiagram",
  "erDiagram",
  "classDiagram",
]);

const OPENERS = "([{";
const CLOSERS = ")]}";

/** Finds every ```mermaid block in a Markdown text. */
export function mermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  let current: MermaidBlock | undefined;
  markdown.split("\n").forEach((text, index) => {
    const trimmed = text.trim();
    if (current === undefined) {
      if (/^```mermaid\s*$/.test(trimmed)) current = { fenceLine: index + 1, lines: [], isClosed: false };
      return;
    }
    if (trimmed.startsWith("```")) {
      blocks.push({ ...current, isClosed: true });
      current = undefined;
      return;
    }
    current.lines.push(text);
  });
  if (current !== undefined) blocks.push(current);
  return blocks;
}

function isContent(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== "" && !trimmed.startsWith("%%");
}

/**
 * The kind of diagram (counted name, such as "flowchart") and the index of its type line, or undefined when the type is
 * unknown or missing.
 */
export function diagramKind(block: MermaidBlock): { kind: string; index: number } | undefined {
  const index = block.lines.findIndex(isContent);
  const typeWord = block.lines[index]?.trim().split(/\s+/)[0] ?? "";
  const kind = DIAGRAM_KINDS.get(typeWord);
  return kind === undefined ? undefined : { kind, index };
}

/** Removes the parts of a line that may hold brackets without meaning them: quoted text, free text and arrow shapes. */
function bracketText(text: string, kind: string): string {
  let result = text.replace(/"[^"]*"/g, "");
  if (FREE_TEXT_AFTER_COLON.has(kind)) result = result.split(":")[0] ?? "";
  if (kind === "sequenceDiagram") result = result.replace(/-{1,2}\)/g, "-");
  if (kind === "erDiagram") result = result.replace(/(?:\|o|\|\||\}o|\}\|)(?:--|\.\.)(?:o\||\|\||o\{|\|\{)/g, " -- ");
  if (kind === "flowchart") result = result.replace(/([A-Za-z0-9_])>[^\]]*\]/g, "$1");
  return result;
}

type OpenBracket = { character: string; line: number };

/** Checks one line's brackets against the brackets still open, and reports what does not match. */
function checkBrackets(text: string, line: number, open: OpenBracket[]): DiagramProblem[] {
  const problems: DiagramProblem[] = [];
  for (const character of text) {
    if (OPENERS.includes(character)) open.push({ character, line });
    const closerIndex = CLOSERS.indexOf(character);
    if (closerIndex === -1) continue;
    const last = open.pop();
    if (last?.character !== OPENERS[closerIndex])
      problems.push({ line, message: `"${character}" does not close anything that is open` });
  }
  return problems;
}

/** Checks that every block opened with subgraph, alt, loop and the like is closed by an "end" line. */
function checkBlockEnds(block: MermaidBlock, kind: string, firstLine: number): DiagramProblem[] {
  const opener = BLOCK_OPENERS.get(kind);
  if (opener === undefined) return [];
  const problems: DiagramProblem[] = [];
  const openLines: number[] = [];
  block.lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (opener.test(trimmed)) openLines.push(firstLine + index);
    if (trimmed !== "end") return;
    if (openLines.pop() === undefined)
      problems.push({ line: firstLine + index, message: '"end" has no block to close' });
  });
  for (const line of openLines) problems.push({ line, message: 'this block is never closed with "end"' });
  return problems;
}

/** Checks quotes and brackets on every content line after the type line. */
function checkLines(block: MermaidBlock, kind: string, firstLine: number): DiagramProblem[] {
  const problems: DiagramProblem[] = [];
  const open: OpenBracket[] = [];
  block.lines.forEach((text, index) => {
    if (!isContent(text)) return;
    const line = firstLine + index;
    if ((text.match(/"/g) ?? []).length % 2 === 1) problems.push({ line, message: "a quote is left open" });
    problems.push(...checkBrackets(bracketText(text, kind), line, open));
  });
  for (const bracket of open) problems.push({ line: bracket.line, message: `"${bracket.character}" is never closed` });
  return problems;
}

/** Every structure problem in one diagram. An empty list means the diagram passed. */
export function diagramProblems(block: MermaidBlock): DiagramProblem[] {
  const firstLine = block.fenceLine + 1;
  const problems: DiagramProblem[] = [];
  if (!block.isClosed) problems.push({ line: block.fenceLine, message: "the ```mermaid fence is never closed" });
  const found = diagramKind(block);
  if (found === undefined) {
    const firstWord = block.lines.find(isContent)?.trim().split(/\s+/)[0];
    const message =
      firstWord === undefined
        ? "the diagram is empty"
        : `"${firstWord}" is not a diagram type this check knows (${[...DIAGRAM_KINDS.keys()].join(", ")})`;
    return [...problems, { line: block.fenceLine, message }];
  }
  const body = block.lines.slice(found.index + 1);
  if (!body.some(isContent))
    problems.push({ line: firstLine + found.index, message: "the diagram has a type but nothing in it" });
  const bodyBlock = { ...block, lines: body };
  const bodyFirstLine = firstLine + found.index + 1;
  return [
    ...problems,
    ...checkLines(bodyBlock, found.kind, bodyFirstLine),
    ...checkBlockEnds(bodyBlock, found.kind, bodyFirstLine),
  ];
}
