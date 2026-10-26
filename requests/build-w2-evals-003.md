Request build/w2-evals-003. File: specs/wave-2-evals.md (the spec, for the integrator to decide and amend). Change wanted: decide each item below; the code as built is named under each (items 1 to 11). No edit to any code file is asked for.

1. Section 1 rule 1 says never create a file under about 40 lines and never a folder with fewer than 3 files. Section 3 lists the seven metric files, which are 21 to 40 lines each, and the fixture folders expected/, human/responses/ and secrets/, which each hold one file. Section 7 asks for 15 files in src/metrics/. Built as listed. Decide: keep the files as listed, or merge the metrics into fewer files.

2. Section 4.2 and 4.3 say an injection on a .json export becomes a second paste source, merged into the card build. Routes build one card per source (POST /api/sources/:id/cards), so no merge exists. Built: an injection rides only on a paste side; an injected .json side is recorded in pairErrors with eval_injection_unsupported. No pair in pairs.json needs the .json case. Decide whether the spec drops that clause.

3. Section 4.5 writes verifyQuote({ quote, turnText, turnNormText, forbiddenTexts }). The receipts package takes { quote, turnText, turnNormText, forbidden }. Built: forbidden.

4. Section 4.3 step 8 says the invite token is the last path segment or the ?token= value of inviteUrl. apps/api/src/pairs/create-pair.ts puts the token after "#". Built: the fragment, as the golden path reads it.

5. Section 4.8 says health.worker must be true in replay. The golden path warns and goes on. Built: a warning line, as the golden path does, and no exit.

6. Section 4.1 has no flag for a targets file, and T14 needs one; section 4.4 EvalRows has no field for the planted markers and their carrier side, and T4 needs them. Built: --targets (EvalFlags.targetsPath) and EvalRows.plantedMarkers.

7. Section 4.6 EvalResults has scrubPlantedSurvivors but no total, while the planted line prints "of 40". Built: scrubPlantedTotal beside it.

8. Section 4.3 step 10 has the start call and its 409 retry, and a lobby poll. Parent note 13 drops the start call and the lobby poll; built without them. The error eval_start_refused is replaced by eval_start_timeout for the 75 s wait for the meeting to leave ready.

9. Section 3 says extractOwnTurns(bytes): Turn[] and personaSignal. packages/parsers/src/extract-own-turns.ts exports extractOwnTurns(inputs, kindHint) returning ExtractResult, with turns, kind, personaSignal, foundTurns and canonicalChars. Built: the parsers shape, and the personaSignal field of its result. Decide whether section 3 is amended to the parsers shape.

10. Section 3 and section 4.5 name apps/worker/src/briefs/index.ts (computeSupportRate). That folder is Wave 2 briefs work and is not in this worktree. Not read and not imported; the metric reads the stored support_rate column, as the spec says.

11. Values the spec does not give, used by the code and not listed in section 8 [confirm]: a 30 s limit for each call and a 60 s limit for an upload (the golden path's values), a 10 s limit for the health read (the golden path's value), a 2 s poll while the meeting waits to leave ready (the golden path uses 1 s), and the new error codes eval_unexpected_status, eval_response_invalid, eval_pairs_invalid, eval_database_missing, eval_start_timeout, eval_injection_unsupported, eval_request_failed, eval_unexpected, readme_missing. Decide each value and code, or name the replacement.

Why: each item is a spec sentence that the code cannot follow as written, or a shape the spec leaves out. The integrator's decision changes the spec, not the code.

Until then: the code uses the as-built shape named under each item; no value is picked beyond that.
