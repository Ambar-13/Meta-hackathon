Request build/w2-evals-001. File: package.json (root). Change wanted: none.

The root script is already `"eval": "pnpm --filter @meet-first/evals run eval"`, and the flags reach packages/evals/src/run-eval.ts unchanged. Checked in this worktree on 26 Oct: `pnpm eval --human` prints "No real pairs yet.", `pnpm eval --live` stops with eval_base_missing, and `pnpm eval --replay` with no api stops with eval_api_unreachable. The `--` form in spec section 3 is therefore not needed.

Why: spec section 3, request 1, asked for this script; the script exists in the form that works.

Until then: no value used; the eval runs from the root with the script as it stands.
