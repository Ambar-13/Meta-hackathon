# Request build/w1-meeting-engine-003

File: `apps/worker/README.md` (owner: dossier, Wave 1)

Change wanted:

```diff
 ## The main pieces
 ...
+- `src/meetings/`: the meeting jobs: one persona turn per `meeting_step`, the stalled-meeting sweeper that also starts ready meetings, and the question check that builds the prompt prefixes.
 ...
 ## Not built yet
-... meetings ...
+... (the same line without the word "meetings")
```

Why: repo rule 2 says the README of every app names its folders. The worker README lists the meeting folder as not built yet, which is no longer true once the meeting jobs merge. Test: none; repo rule 2 is checked by reading the README.

Until then: the worker README names no meeting folder. No value is used.
