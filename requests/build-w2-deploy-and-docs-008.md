# Request build/w2-deploy-and-docs-008: Mermaid box count

Request build/w2-deploy-and-docs-008. File: scripts/checks/mermaid-structure.ts.

Change wanted:

Add a rule to `diagramProblems`: count the boxes of each diagram and report a diagram with more than 15 as an error. Boxes are the distinct node names in a flowchart or stateDiagram, the participants in a sequenceDiagram, and the entities in an erDiagram.

```diff
+/** The most boxes one diagram may hold, from the style rules (about 15 boxes). */
+export const MAX_BOXES = 15;
...
 export function diagramProblems(block: MermaidBlock): DiagramProblem[] {
   ...
+  const boxes = boxNames(block, found.kind);
+  if (boxes.size > MAX_BOXES)
+    problems.push({ line: block.fenceLine, message: `has ${String(boxes.size)} boxes; the limit is ${String(MAX_BOXES)}` });
```

Why: test W2-DEPLOY-T11 needs `pnpm checks` to fail on a 16-box flowchart and to pass one with 15. The frozen check has no box count today.

Until then: T11 fails on the 16-box case. Counted by hand, the diagrams in this worktree hold at most 15 boxes: OVERVIEW has a 7-box flowchart, a 5-participant sequence and a 15-entity data diagram; each STATES diagram has at most 6 states, counting the start point; SAFETY has 6 and 7 boxes..
