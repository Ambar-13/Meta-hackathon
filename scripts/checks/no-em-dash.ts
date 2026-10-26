// Fails on the em dash character (U+2014) in product text, docs, prompts and source (standing rule).
// Test fixtures build the character at runtime, so this file never contains it.
import { type Finding } from "./finding.js";
import { readLines } from "./read-lines.js";
import { walkFiles } from "./walk-files.js";

const EM_DASH = String.fromCodePoint(0x2014);
const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|yaml|yml|sql|txt|html|css|py|toml)$|^Dockerfile$/;
const SEARCHED_FOLDERS: readonly string[] = [
  "apps",
  "packages",
  "docs",
  "prompts",
  "scripts",
  "tests",
  "provider-checks",
];

/** Every line of a text file in the searched folders that holds an em dash, with its file and line number. */
export function noEmDash(root: string): Finding[] {
  const files = SEARCHED_FOLDERS.flatMap((folder) => walkFiles(root, folder, (name) => TEXT_FILE.test(name)));
  return files.flatMap((file) =>
    readLines(file).flatMap((text, index) =>
      text.includes(EM_DASH)
        ? [{ check: "no-em-dash", file, line: index + 1, message: "em dash (U+2014); rewrite the sentence" }]
        : [],
    ),
  );
}
