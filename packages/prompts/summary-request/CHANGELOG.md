# summary-request prompt: changelog

| Version | Date | Change | Motivated by | Re-run | Lint | Reads |
|---|---|---|---|---|---|---|
| v1 | 2026-11-03 | First version. | The summary a person's own AI writes about them, read by `parseSummary` and checked by check_summary | No test run: 0 of 8 tests run. | By the writer, not independent: word-list checks on the body, 3 hits, 2 reworded, 1 inside a quoted example (exempt); structural read for task, sources, rules, format, leave-out list, failure branches, self-check and examples with rationales, none missing. | A hostile-input read by the writer, not independent; its findings are the P1 table in cases.md. |

Status: draft. Adversarial test set: 8 tests specified, 0 run. Not for production until every test has 3 recorded runs in ChatGPT and in Claude.
