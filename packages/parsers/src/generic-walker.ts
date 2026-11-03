import type { RawTurn } from "./chatgpt-shapes.js";

// How deep the walk goes below the root, so a pathological file cannot exhaust the stack (picked here).
const WALK_DEPTH_MAX = 40;
// The roles that count as the uploader's own words.
const OWN_ROLES: ReadonlyArray<string> = ["user", "human"];

// True when a value is a plain object or an array, the only shapes the walk looks inside.
function isNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// True when author.role, role or sender holds one of the roles that count as the uploader.
function isOwnRole(node: Record<string, unknown>): boolean {
  const author = node.author;
  const authorRole = isNode(author) ? author.role : undefined;
  return [authorRole, node.role, node.sender].some((role) => typeof role === "string" && OWN_ROLES.includes(role));
}

// The string elements of a parts array joined by a line break.
function joinStrings(parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === "string").join("\n");
}

// The text of a kept object, taken from the first field that applies: text, content, parts, content.parts, content.text.
function textOf(node: Record<string, unknown>): string | null {
  if (typeof node.text === "string") return node.text;
  if (typeof node.content === "string") return node.content;
  if (Array.isArray(node.parts)) return joinStrings(node.parts as unknown[]);
  const content = isNode(node.content) ? node.content : {};
  if (Array.isArray(content.parts)) return joinStrings(content.parts as unknown[]);
  if (typeof content.text === "string") return content.text;
  return null;
}

// The create time of a kept object: create_time when it is a number, else created_at when it is a date, else null.
function timeOf(node: Record<string, unknown>): number | null {
  if (typeof node.create_time === "number") return node.create_time;
  if (typeof node.created_at !== "string") return null;
  const milliseconds = Date.parse(node.created_at);
  return Number.isNaN(milliseconds) ? null : milliseconds / 1000;
}

// Visits one value: a kept object becomes a turn (or is dropped when its text is empty) and is not looked into; any other value has its children visited.
function visit(value: unknown, depth: number, found: RawTurn[]): void {
  if (depth > WALK_DEPTH_MAX || !isNode(value)) return;
  if (isOwnRole(value)) {
    const text = textOf(value);
    if (text !== null && text !== "") found.push({ text, exportOrder: 0, createTime: timeOf(value) });
    return;
  }
  for (const child of Object.values(value)) visit(child, depth + 1, found);
}

// Walks any JSON value depth-first (depth cap 40) and keeps every object that has `author.role` or `role` or `sender` equal to
// "user" or "human" and a string in `text`, `content`, or string elements of `parts`. Order is document order.
export function walkGeneric(root: unknown): RawTurn[] {
  const found: RawTurn[] = [];
  visit(root, 0, found);
  return found.map((turn, index) => ({ ...turn, exportOrder: index }));
}
