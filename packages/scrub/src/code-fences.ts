import { CODE_FENCE_PLACEHOLDER } from "@meet-first/contracts";
import type { Segment } from "./placeholders.js";

// A line that opens a fence: up to 3 spaces, 3 or more backticks or tildes, optional spaces, then an optional language word.
export const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)/;
// The language word a placeholder may keep: 1 to 20 of a-z, 0-9 and _ + #. -; anything else becomes "text".
export const FENCE_LANGUAGE = /^[a-z0-9_+#.-]{1,20}$/;

// One output line after the fences are replaced: its text, and whether it is a fence placeholder.
type OutputLine = { text: string; isFence: boolean };

// The line index that closes a fence opened on `start` with `marker`, or the line count when no line closes it.
function closingIndex(lines: string[], start: number, marker: string): number {
  const closer = new RegExp(
    "^[ \\t]{0,3}" + marker.charAt(0) + "{" + String(marker.length) + ",}[ \\t]*$",
  );
  for (let index = start + 1; index < lines.length; index += 1) {
    if (closer.test(lines[index] ?? "")) return index;
  }
  return lines.length;
}

// The language word of an opening line, lower-cased, or "" when it is not a plain language name.
function languageOf(raw: string): string {
  const lower = raw.toLowerCase();
  return FENCE_LANGUAGE.test(lower) ? lower : "";
}

// Turns the output lines into segments: fence lines are protected, and the free text between them stays free.
function toSegments(output: OutputLine[]): Segment[] {
  const segments: Segment[] = [];
  let buffer = "";
  output.forEach((line, index) => {
    if (index > 0) buffer += "\n";
    if (!line.isFence) {
      buffer += line.text;
      return;
    }
    if (buffer !== "") segments.push({ text: buffer, isProtected: false, category: null });
    segments.push({ text: line.text, isProtected: true, category: "code" });
    buffer = "";
  });
  if (buffer !== "") segments.push({ text: buffer, isProtected: false, category: null });
  return segments;
}

// Replaces every fenced block with one [code: lang, n lines] line and returns the text as segments.
export function replaceCodeFences(text: string): Segment[] {
  const lines = text.split("\n");
  const output: OutputLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const opener = FENCE_OPEN.exec(line);
    if (opener === null) {
      output.push({ text: line, isFence: false });
      index += 1;
      continue;
    }
    const close = closingIndex(lines, index, opener[1] ?? "`");
    const count = close - index - 1;
    output.push({
      text: CODE_FENCE_PLACEHOLDER(languageOf(opener[2] ?? ""), count),
      isFence: true,
    });
    index = close + 1;
  }
  return toSegments(output);
}
