// The architecture docs exist with the pictures the style rules ask for, and every
// Mermaid diagram in the repository's Markdown passes the structure check in mermaid-structure.ts.
// OVERVIEW.md, STATES.md, SAFETY.md and GLOSSARY.md are written in the style pass that comes later,
// so until then their absence is a warning, not an error (see style-scope.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Finding } from "./finding.js";
import { walkFiles } from "./walk-files.js";
import { diagramKind, diagramProblems, mermaidBlocks } from "./mermaid-structure.js";
import { levelFor, readPassedPaths } from "./style-scope.js";

/** A document that must exist, and how many diagrams of each kind it must hold at least. */
export type RequiredDocument = { path: string; diagrams: Readonly<Record<string, number>> };

/** The architecture docs and their pictures, from the style rules. */
export const REQUIRED_DOCUMENTS: readonly RequiredDocument[] = [
  { path: "docs/architecture/OVERVIEW.md", diagrams: { flowchart: 1, sequenceDiagram: 1, erDiagram: 1 } },
  { path: "docs/architecture/STATES.md", diagrams: { stateDiagram: 6 } },
  { path: "docs/architecture/SAFETY.md", diagrams: { flowchart: 2 } },
  { path: "docs/GLOSSARY.md", diagrams: {} },
];

const MARKDOWN_FOLDERS = ["apps", "packages", "docs", "scripts", "tests", "provider-checks"];

/** How many diagrams of each kind a Markdown text holds, such as {flowchart: 2}. */
export function countDiagramKinds(markdown: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of mermaidBlocks(markdown)) {
    const kind = diagramKind(block)?.kind;
    if (kind !== undefined) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

function checkRequiredDocument(root: string, document: RequiredDocument, passedPaths: readonly string[]): Finding[] {
  const file = join(root, document.path);
  const level = levelFor(root, file, passedPaths);
  if (!existsSync(file)) {
    return [{ check: "architecture-docs", file, line: 1, message: "is missing; the architecture docs need it", level }];
  }
  const counts = countDiagramKinds(readFileSync(file, "utf8"));
  const findings: Finding[] = [];
  for (const [kind, needed] of Object.entries(document.diagrams)) {
    const found = counts.get(kind) ?? 0;
    if (found < needed)
      findings.push({
        check: "architecture-docs",
        file,
        line: 1,
        message: `needs ${String(needed)} ${kind} diagram(s) and has ${String(found)}`,
        level,
      });
  }
  return findings;
}

function checkDiagramsIn(root: string, file: string, passedPaths: readonly string[]): Finding[] {
  const level = levelFor(root, file, passedPaths);
  return mermaidBlocks(readFileSync(file, "utf8")).flatMap((block) =>
    diagramProblems(block).map((problem) => ({
      check: "architecture-docs",
      file,
      line: problem.line,
      message: `diagram: ${problem.message}`,
      level,
    })),
  );
}

/** Checks the required architecture docs, then every Mermaid diagram in the repository's Markdown. */
export function checkArchitectureDocs(root: string): Finding[] {
  const passedPaths = readPassedPaths(root);
  const markdownFiles = [
    join(root, "README.md"),
    ...MARKDOWN_FOLDERS.flatMap((folder) => walkFiles(root, folder, (name) => name.endsWith(".md"))),
  ];
  return [
    ...REQUIRED_DOCUMENTS.flatMap((document) => checkRequiredDocument(root, document, passedPaths)),
    ...markdownFiles.filter((file) => existsSync(file)).flatMap((file) => checkDiagramsIn(root, file, passedPaths)),
  ];
}
