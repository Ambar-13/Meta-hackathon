// A structure check for the Mermaid diagrams written inside Markdown.
// This is not Mermaid's full grammar. The real parser needs the mermaid package and a browser page,
// and the repository installs neither. This check catches the mistakes that most often stop a diagram
// from drawing:
// - a diagram that is empty, or whose first line is not a known diagram type
// - a bracket or a quote left open, or a bracket closed that was never opened
// - a block (subgraph, alt, loop and the like) with no matching "end"
// - a mermaid fence that is never closed
// - a diagram with more than 15 boxes, which no longer reads at a glance

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

// In these diagram types, the text after the first colon is free text, such as a message or a
// label.
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
      if (/^```mermaid\s*$/.test(trimmed))
        current = { fenceLine: index + 1, lines: [], isClosed: false };
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
  if (kind === "erDiagram")
    result = result.replace(/(?:\|o|\|\||\}o|\}\|)(?:--|\.\.)(?:o\||\|\||o\{|\|\{)/g, " -- ");
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
  for (const line of openLines)
    problems.push({ line, message: 'this block is never closed with "end"' });
  return problems;
}

/** Checks quotes and brackets on every content line after the type line. */
function checkLines(block: MermaidBlock, kind: string, firstLine: number): DiagramProblem[] {
  const problems: DiagramProblem[] = [];
  const open: OpenBracket[] = [];
  block.lines.forEach((text, index) => {
    if (!isContent(text)) return;
    const line = firstLine + index;
    if ((text.match(/"/g) ?? []).length % 2 === 1)
      problems.push({ line, message: "a quote is left open" });
    problems.push(...checkBrackets(bracketText(text, kind), line, open));
  });
  for (const bracket of open)
    problems.push({ line: bracket.line, message: `"${bracket.character}" is never closed` });
  return problems;
}

/** The most boxes one diagram may hold: the style rule of at most 15 boxes. */
export const MAX_BOXES = 15;

// Lines that name no box: block openers and closers, styling, notes and activations.
const NO_BOX_LINE =
  /^(subgraph|end|direction|classDef|class|style|linkStyle|click|note|Note|alt|else|opt|loop|par|and|critical|break|rect|box|activate|deactivate|autonumber|title)\b/;

// The words of a flowchart line that are never a node name: its own keywords and directions.
const FLOWCHART_WORDS: ReadonlySet<string> = new Set([
  "flowchart",
  "graph",
  "TB",
  "TD",
  "BT",
  "RL",
  "LR",
]);

// Removes quoted text and every bracketed shape, innermost first, so a label never reads as a box
// name.
function withoutShapes(text: string): string {
  let result = text.replace(/"[^"]*"/g, "");
  for (let previous = ""; previous !== result; ) {
    previous = result;
    result = result.replace(/\[[^[\]]*\]|\([^()]*\)|\{[^{}]*\}/g, "");
  }
  return result;
}

// The node names of one flowchart line: the ids on either side of each arrow, with edge labels and
// class marks removed.
function flowchartNames(text: string): string[] {
  const bare = withoutShapes(text)
    .replace(/\|[^|]*\|/g, "")
    .replace(/(?:--|==|-\.)[^>]*?(?:-->|==>|\.->)/g, " --> ")
    .replace(/:::\w+/g, "");
  return (bare.match(/[A-Za-z_]\w*/g) ?? []).filter((word) => !FLOWCHART_WORDS.has(word));
}

// The state names of one state diagram line: the states on either side of each arrow, or the one a
// state line declares.
function stateNames(text: string): string[] {
  const head = (text.split(":")[0] ?? "").replace(/\[\*\]/g, "");
  const alias = /^state\s+"[^"]*"\s+as\s+(\w+)/.exec(head);
  if (alias?.[1] !== undefined) return [alias[1]];
  return (withoutShapes(head).match(/[A-Za-z_]\w*/g) ?? []).filter((word) => word !== "state");
}

// The participant names of one sequence diagram line: a declared participant, or the sender and the
// receiver of a message.
function sequenceNames(text: string): string[] {
  const declared = /^(?:participant|actor)\s+(\w+)/.exec(text);
  if (declared?.[1] !== undefined) return [declared[1]];
  const head = text.split(":")[0] ?? "";
  return head
    .split(/--?>>|--?>|--?x|--?\)/)
    .map((part) => /\w+/.exec(part.replace(/^\s*[+-]/, ""))?.[0])
    .filter((name): name is string => name !== undefined);
}

// The entity names of one data diagram line: the entity a block opens, or the two entities of a
// relationship.
function entityNames(text: string): string[] {
  const words = (text.split(":")[0] ?? "").trim().split(/\s+/);
  if (text.endsWith("{")) return words.slice(0, 1);
  const first = words[0];
  const last = words[words.length - 1];
  return words.length >= 3 && first !== undefined && last !== undefined ? [first, last] : [];
}

// The box names of one line, by the kind of diagram it is in. Kinds without a rule here count no
// boxes.
function lineNames(text: string, kind: string): string[] {
  if (kind === "flowchart") return flowchartNames(text);
  if (kind === "stateDiagram") return stateNames(text);
  if (kind === "sequenceDiagram") return sequenceNames(text);
  if (kind === "erDiagram") return entityNames(text);
  return [];
}

/** The distinct box names of a diagram body (the lines after its type line): nodes, states, participants or entities. */
export function boxNames(lines: readonly string[], kind: string): Set<string> {
  const names = new Set<string>();
  let isInEntity = false;
  for (const raw of lines) {
    const text = raw.trim();
    if (!isContent(text) || NO_BOX_LINE.test(text)) continue;
    if (kind === "erDiagram") {
      if (text === "}" || isInEntity) {
        isInEntity = text !== "}" && isInEntity;
        continue;
      }
      isInEntity = text.endsWith("{");
    }
    for (const name of lineNames(text, kind)) names.add(name);
  }
  return names;
}

/** Every structure problem in one diagram. An empty list means the diagram passed. */
export function diagramProblems(block: MermaidBlock): DiagramProblem[] {
  const firstLine = block.fenceLine + 1;
  const problems: DiagramProblem[] = [];
  if (!block.isClosed)
    problems.push({ line: block.fenceLine, message: "the ```mermaid fence is never closed" });
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
    problems.push({
      line: firstLine + found.index,
      message: "the diagram has a type but nothing in it",
    });
  const boxes = boxNames(body, found.kind);
  if (boxes.size > MAX_BOXES)
    problems.push({
      line: block.fenceLine,
      message: `the diagram has ${String(boxes.size)} boxes; the limit is ${String(MAX_BOXES)}`,
    });
  const bodyBlock = { ...block, lines: body };
  const bodyFirstLine = firstLine + found.index + 1;
  return [
    ...problems,
    ...checkLines(bodyBlock, found.kind, bodyFirstLine),
    ...checkBlockEnds(bodyBlock, found.kind, bodyFirstLine),
  ];
}
