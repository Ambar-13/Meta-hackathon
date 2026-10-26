Request build-w6-asks-worker-001. File: apps/worker/README.md. Change wanted: in the paragraph under "## The main pieces", right after the sentence that starts "`src/meetings/` holds the meeting jobs", insert this sentence:
+ `src/asks/` holds the `run_ask` job: the question check of a help search or a friend ask, the answer rows, one persona answer for each listed persona or friend, and the support check that places the help answers.
Why: no test needs it; repo rule 2 keeps a README in step with its code. Until then: the worker README does not name src/asks/.
