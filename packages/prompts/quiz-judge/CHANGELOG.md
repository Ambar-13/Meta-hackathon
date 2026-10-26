# quiz-judge changelog

Each version is a new folder; a version is never edited in place (IMPLEMENTATION.md 2.5).

| Version | Date | Change | Motivated by | Re-run | Lint | Reads |
|---|---|---|---|---|---|---|
| v1 | 2026-10-26 | First version | D30, R4.4, R4.6: a blind yes or no judge whose drift shows inside every quiz | 0 of 15 tests run | by the writer, results below | by the writer, not independent, results below |

## v1 self-check answers

1. The whole stack was read: yes. The worker sends this prompt as the system message and the question and both answers as the user message (quiz-requests.ts).
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
| Rules: five rules in order, a test with pass, fail and near-miss, times and amounts given as numbers | passed |
| Boundary: three channels named, eight framings, scope rule, platform line | passed |
| Actions and failures: no tools, a verdict for every input kind | passed |
| Voice: the never-list honoured, every example with a rationale | passed |
| Hygiene: no placeholder, one date in the version line, no em dash | passed |

## v1 reads, by the writer, not independent; 0 test runs; Status: draft

- Laziest target: says true whenever the answers share a topic word. Closed by rule 4's near-miss and example 2; test JG-T2.
- Laziest target: says true when nothing conflicts. Closed by rule 2 and example 3; test JG-T3.
- Laziest target: leans toward the first answer. Closed by the precedence line on order and self-check question 2; the worker also reverses the order in its rerun; test JG-T9.
- Hostile input: an answer that tells the judge to agree. Closed by section 3 and example 4; test JG-T7.
- Hostile input: an answer that closes its block early. Closed in code, because the worker escapes &, < and > (quiz-requests.ts).

## How a new version lands

A change is a new `v2/` folder with its own `prompt.md`, a new row in the table above, and fresh replay fixtures. `schema.json` changes only through the integrator (D75), and only the prompts owner flips `packages/prompts/src/current.ts` (IMPLEMENTATION.md section 8).
