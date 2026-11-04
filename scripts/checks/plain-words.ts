// Flags the words and phrases that the style rules ban, wherever people read our words:
// - Markdown docs and READMEs (code blocks and `code` spans are skipped)
// - comments in code, and the text of error messages (anything thrown, anything passed to a class
// whose name ends in "Error", and any "message" or "detail" field)
// - comments in SQL migrations
// A line that contains "" is skipped, so a word can be quoted on purpose.
// Instructions written for AI agents (prompt files, CLAUDE.md, AGENTS.md, SKILL.md) are not checked.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { type Finding } from "./finding.js";
import { walkFiles } from "./walk-files.js";
import { levelFor, readPassedPaths, repositoryPath } from "./style-scope.js";

/** The words and phrases the style rules ban, in lower case. */
export const BANNED_PHRASES: readonly string[] = [
  "leverage",
  "robust",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "state-of-the-art",
  "world-class",
  "best-in-class",
  "powerful",
  "delve",
  "tapestry",
  "holistic",
  "synergy",
  "paradigm",
  "empower",
  "elevate",
  "unlock",
  "harness",
  "streamline",
  "game-changer",
  "a wide range of",
  "a myriad of",
  "it's important to note that",
  "it's worth noting",
  "let's dive in",
  "in today's world",
  "in conclusion",
  "in summary",
  "is responsible for",
  "serves as",
  "plays a crucial role in",
  "in order to",
  "utilize",
  "simply",
  "just",
  "obviously",
  "basically",
  "essentially",
  "very",
  "really",
  "elegant",
  "clean",
  "efficient",
  "novel",
  "we show that",
  "as we will see",
];

/** The marker that lets one line quote a banned word on purpose. */
export const ALLOW_MARKER = "plain-words: allow";

/** A piece of text people read, with the line it starts on (from 1). */
export type ProseLine = { line: number; text: string };

function escapeForPattern(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "Overall" is banned as an empty opener, written with a comma after it, and not as a plain
// adjective ("the overall budget").
const PATTERNS: readonly { phrase: string; pattern: RegExp }[] = [
  ...BANNED_PHRASES.map((phrase) => ({
    phrase,
    pattern: new RegExp(`\\b${escapeForPattern(phrase)}\\b`, "i"),
  })),
  { phrase: "overall,", pattern: /\boverall,/i },
  // Emphasis words are banned as sentence openers (followed by a comma); say why the thing matters
  // instead.
  ...["importantly", "crucially", "notably", "interestingly"].map((word) => ({
    phrase: `${word},`,
    pattern: new RegExp(`\\b${word},`, "i"),
  })),
];

/** The banned words and phrases that appear in one piece of text. */
export function bannedPhrasesIn(text: string): string[] {
  const normalized = text.replace(/[‘’]/g, "'");
  return PATTERNS.filter(({ pattern }) => pattern.test(normalized)).map(({ phrase }) => phrase);
}

/** The prose lines of a Markdown text: fenced code blocks, `code` spans and link targets are left out. */
export function markdownProse(markdown: string): ProseLine[] {
  const prose: ProseLine[] = [];
  let isInCodeBlock = false;
  markdown.split("\n").forEach((text, index) => {
    if (text.trim().startsWith("```")) {
      isInCodeBlock = !isInCodeBlock;
      return;
    }
    if (isInCodeBlock) return;
    prose.push({
      line: index + 1,
      text: text.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]"),
    });
  });
  return prose;
}

function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function commentLines(sourceFile: ts.SourceFile): ProseLine[] {
  const text = sourceFile.getFullText();
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [])
      ranges.set(range.pos, range);
    for (const range of ts.getTrailingCommentRanges(text, node.getEnd()) ?? [])
      ranges.set(range.pos, range);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...ranges.values()].flatMap((range) => {
    const firstLine = lineOf(sourceFile, range.pos);
    return text
      .slice(range.pos, range.end)
      .split("\n")
      .map((part, offset) => ({ line: firstLine + offset, text: part }));
  });
}

function nameOf(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function extendsAnError(node: ts.Node): boolean {
  const owner = ts.findAncestor(node, ts.isClassLike);
  const heritage = owner?.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  return heritage?.types.some((type) => nameOf(type.expression).endsWith("Error")) ?? false;
}

function isMessageField(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) return false;
  const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
  return name === "message" || name === "detail";
}

/**
 * True for a node whose text is an error message: a throw, an Error being made, super() in an Error class, or a message
 * field.
 */
function holdsErrorMessage(node: ts.Node): boolean {
  if (ts.isThrowStatement(node) || isMessageField(node)) return true;
  if (ts.isNewExpression(node)) return nameOf(node.expression).endsWith("Error");
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword)
    return extendsAnError(node);
  return false;
}

function stringsInside(node: ts.Node, sourceFile: ts.SourceFile): ProseLine[] {
  const found: ProseLine[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isStringLiteralLike(child) || ts.isTemplateLiteralToken(child))
      found.push({ line: lineOf(sourceFile, child.getStart(sourceFile)), text: child.text });
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** The comments and error-message text of a TypeScript or JavaScript source. */
export function codeProse(fileName: string, source: string): ProseLine[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const messages: ProseLine[] = [];
  const visit = (node: ts.Node): void => {
    if (holdsErrorMessage(node)) {
      messages.push(...stringsInside(node, sourceFile));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...commentLines(sourceFile), ...messages];
}

/** The comment text of each SQL line (after "--"). */
export function sqlProse(source: string): ProseLine[] {
  return source.split("\n").flatMap((text, index) => {
    const commentStart = text.indexOf("--");
    return commentStart === -1 ? [] : [{ line: index + 1, text: text.slice(commentStart + 2) }];
  });
}

/** True for instructions written for AI agents, which follow their own standard. */
export function isAgentInstructions(path: string): boolean {
  const fileName = path.split("/").pop() ?? "";
  return (
    ["CLAUDE.md", "AGENTS.md", "SKILL.md", "prompt.md", "cases.md"].includes(fileName) ||
    /(^|\/)prompts\/.*\.md$/.test(path) ||
    /^packages\/prompts\/[^/]+\/v1\//.test(path)
  );
}

function proseOf(path: string, source: string): ProseLine[] {
  if (path.endsWith(".md")) return markdownProse(source);
  if (path.endsWith(".sql")) return sqlProse(source);
  return codeProse(path, source);
}

const CHECKED_FILE = /\.(md|sql|ts|tsx|js|mjs|cjs)$/;
const CHECKED_FOLDERS = ["apps", "packages", "docs", "scripts", "tests"];

/** Every file this check reads: the root README plus docs, code and SQL, without agent instructions. */
function checkedFiles(root: string): string[] {
  const found = CHECKED_FOLDERS.flatMap((folder) =>
    walkFiles(root, folder, (name) => CHECKED_FILE.test(name) && !name.endsWith(".d.ts")),
  );
  return [join(root, "README.md"), ...found].filter(
    (file) => existsSync(file) && !isAgentInstructions(repositoryPath(root, file)),
  );
}

/** The banned phrases of one file, grouped by line, leaving out lines that carry the allow marker. */
export function bannedPhrasesByLine(path: string, source: string): Map<number, Set<string>> {
  const sourceLines = source.split("\n");
  const byLine = new Map<number, Set<string>>();
  for (const { line, text } of proseOf(path, source)) {
    if (sourceLines[line - 1]?.includes(ALLOW_MARKER) === true) continue;
    const phrases = bannedPhrasesIn(text);
    if (phrases.length > 0) byLine.set(line, new Set([...(byLine.get(line) ?? []), ...phrases]));
  }
  return byLine;
}

/** Reports every line of docs, comments and error messages that uses a banned word or phrase. */
export function checkPlainWords(root: string): Finding[] {
  const passedPaths = readPassedPaths(root);
  const findings: Finding[] = [];
  for (const file of checkedFiles(root)) {
    const level = levelFor(root, file, passedPaths);
    for (const [line, phrases] of bannedPhrasesByLine(
      repositoryPath(root, file),
      readFileSync(file, "utf8"),
    )) {
      const quoted = [...phrases].map((phrase) => `"${phrase}"`).join(", ");
      findings.push({
        check: "plain-words",
        file,
        line,
        message: `uses ${quoted}; say it plainly, or add "${ALLOW_MARKER}" to the line to quote it on purpose`,
        level,
      });
    }
  }
  return findings;
}
