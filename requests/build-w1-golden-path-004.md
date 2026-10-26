# Request build/w1-golden-path-004

File: packages/db/src/index.ts

Change wanted:

```diff
 // The event log seq and the event append (invariant 11).
 export { nextEventSeq, appendMeetingEvent } from "./event-seq.js";
+// Counts, table by table, the rows that still point at one person (D69, invariant 16). The golden path reads it after a deletion.
+export { countRowsForPerson } from "./count-person.js";
```

Why: scripts/golden-path/database-reads.ts reads the per-table person counts for step 16 (`countPerson`), and the spec says that count is the one in packages/db/src/count-person.ts. That file is not exported from the package index, and the package exports map allows only `.` and `./testing`. So `tsc` reports TS2305 on the import, and the entry script `pnpm golden-path` fails at load time under Node's ESM linker with a SyntaxError before any step runs. This blocks the live command. The comment line is the one the export rule of eslint.config.js needs above an export.

Until then: the golden-path code names `countRowsForPerson` and does not import the file any other way. For the entry's exit-code checks I added this one line to the index file, ran them, and restored the file from git; the repository copy is unchanged by my run.

Resolved at merge, 26 Oct: applied on main with the golden-path merge.
