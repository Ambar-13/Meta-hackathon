# quiz-persona-answer changelog

Each version is a new folder; a version is never edited in place (IMPLEMENTATION.md 2.5).

| Version | Date | Change | Motivated by | Re-run | Lint | Reads |
|---|---|---|---|---|---|---|
| v1 | 2026-10-26 | First version | D28, R4.1, R4.3: the quiz needs one grounded answer per question | 0 of 12 tests run | by the writer, results below | by the writer, not independent, results below |

## v1 self-check answers

1. The whole stack was read: yes. The worker sends this prompt as the system message and the card and question as the user message (quiz-requests.ts).
2. Every section of the standard order exists, or the version line names it as absent with its reason: yes.
3. Degree words outside quoted text: none found in the writer's read.
4. Every never-list closes its excuses and ends with a catch-all: yes, sections 3 and 4.
5. Every tool has its failure branches and its cost: no tools, so none apply.
6. Every bad example is fluent and wrong for one named reason: yes, six examples.
7. The version line is present, dated and names its assumptions: yes.
8. The test set has run: no. 0 runs, so the status is draft.
9. The status word comes first: yes, "Status: draft".

## v1 static lint, by the writer

| Group | Result |
|---|---|
| Structure: sections named, section map, one referent ("you") | passed |
| Rules: triggers, numbers, a test with pass, fail and near-miss | passed |
| Boundary: both channels named, eight framings, scope rule, platform line | passed |
| Actions and failures: no tools, a branch for every input kind | passed |
| Voice: the never-list honoured, every example with a rationale | passed |
| Hygiene: no placeholder, one date in the version line, no em dash | passed |

## v1 reads, by the writer, not independent; 0 test runs; Status: draft

- Laziest target: answers every question with a plausible guess. Closed by section 6 step 2 and the scripted line of section 11.
- Laziest target: rounds a stance into a number, such as "after 8 pm". Closed by section 6 step 4 and example 1.
- Hostile input: a quote that tells the model what to answer. Closed by section 3 and example 3; test PA-T3.
- Hostile input: a quote that tries to close the card block early. Closed in code, because the worker escapes &, < and > (quiz-requests.ts); test PA-T9.
- Hostile input: a placeholder that invites a guess. Closed by section 4 and example 6; test PA-T4.

## How a new version lands

A change is a new `v2/` folder with its own `prompt.md`, a new row in the table above, and fresh replay fixtures. `schema.json` changes only through the integrator (D75), and only the prompts owner flips `packages/prompts/src/current.ts` (IMPLEMENTATION.md section 8).
