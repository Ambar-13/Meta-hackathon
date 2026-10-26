// Every app and package has a README.md with the five headings, in order, and a Mermaid diagram
// under "How it fits". Whether a problem is an error or a warning
// depends on the passed list (see style-scope.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding } from "./finding.js";
import { levelFor, readPassedPaths } from "./style-scope.js";

/** The five README headings, in the order they must appear. */
export const README_HEADINGS: readonly string[] = [
  "What this does",
  "What this never does",
  "How it fits",
  "The main pieces",
  "How to test it",
];

/** A problem found in one README, with the line it is on. */
export type ReadmeProblem = { line: number; message: string };

const HEADING = /^##\s+(?:\d+\.\s*)?(.+?)\s*$/;

/** Every folder under apps/ and packages/ that holds a package.json, as repository paths. */
export function workspaceFolders(root: string): string[] {
  const folders: string[] = [];
  for (const group of ["apps", "packages"]) {
    const groupPath = join(root, group);
    if (!existsSync(groupPath)) continue;
    for (const name of readdirSync(groupPath).sort()) {
      if (existsSync(join(groupPath, name, "package.json"))) folders.push(`${group}/${name}`);
    }
  }
  return folders;
}

/** The line number (from 1) of each "## " heading, keyed by its text in lower case. */
function headingLines(lines: readonly string[]): Map<string, number> {
  const found = new Map<string, number>();
  lines.forEach((text, index) => {
    const title = text.match(HEADING)?.[1]?.toLowerCase();
    if (title !== undefined && !found.has(title)) found.set(title, index + 1);
  });
  return found;
}

/** True when a ```mermaid block starts between the "How it fits" heading and the next "## " heading. */
function hasDiagramUnder(lines: readonly string[], headingLine: number): boolean {
  for (const text of lines.slice(headingLine)) {
    if (text.startsWith("## ")) return false;
    if (/^```mermaid\s*$/.test(text.trim())) return true;
  }
  return false;
}

/** Finds missing headings, headings out of order, and a missing diagram under "How it fits". */
export function readmeProblems(text: string): ReadmeProblem[] {
  const lines = text.split("\n");
  const found = headingLines(lines);
  const problems: ReadmeProblem[] = [];
  let previousLine = 0;
  for (const heading of README_HEADINGS) {
    const line = found.get(heading.toLowerCase());
    if (line === undefined) {
      problems.push({ line: 1, message: `has no "## ${heading}" heading` });
      continue;
    }
    if (line < previousLine)
      problems.push({ line, message: `"## ${heading}" is out of order; the five headings go in their fixed order` });
    previousLine = Math.max(previousLine, line);
  }
  const fitsLine = found.get("how it fits");
  if (fitsLine !== undefined && !hasDiagramUnder(lines, fitsLine))
    problems.push({ line: fitsLine, message: 'has no Mermaid diagram under "How it fits"' });
  return problems;
}

/** Checks the README of every app and package. */
export function checkReadmeHeadings(root: string): Finding[] {
  const passedPaths = readPassedPaths(root);
  const findings: Finding[] = [];
  for (const folder of workspaceFolders(root)) {
    const readme = join(root, folder, "README.md");
    const level = levelFor(root, readme, passedPaths);
    if (!existsSync(readme)) {
      findings.push({
        check: "readme-headings",
        file: readme,
        line: 1,
        message: "is missing; every app and package needs a README with the five headings",
        level,
      });
      continue;
    }
    for (const problem of readmeProblems(readFileSync(readme, "utf8")))
      findings.push({ check: "readme-headings", file: readme, ...problem, level });
  }
  return findings;
}
