# summary-request prompt: changelog

| Version | Date | Change | Motivated by | Re-run | Lint | Reads |
|---|---|---|---|---|---|---|
| v1.1 | 2026-11-04 | Rule 8 asks for quotes of at least 20 characters, or 10 without spaces, where v1.0 asked for 6 words. | The final review: Meety's quote check refuses a spaced quote under 20 characters, so a six-word quote such as "I am not a fan ok" could never be found. | No test run: 0 of 8 tests run. | Word-list check by the writer on the changed rule, 0 hits. | None beyond v1.0's. |
| v1 | 2026-11-03 | First version. | The summary a person's own AI writes about them, read by `parseSummary` and checked by check_summary | No test run: 0 of 8 tests run. | By the writer, not independent: word-list checks on the body, 3 hits, 2 reworded, 1 inside a quoted example (exempt); structural read for task, sources, rules, format, leave-out list, failure branches, self-check and examples with rationales, none missing. | A hostile-input read by the writer, not independent; its findings are the P1 table in cases.md. |

Status: draft. Adversarial test set: 8 tests specified, 0 run. Not for production until every test has 3 recorded runs in ChatGPT and in Claude.
