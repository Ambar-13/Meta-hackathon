# How AI was used

## In the product

Meet First calls the Meta Model API. The model is muse-spark-1.3 for the names pass, the card, the quiz answers and the quiz judge, the meeting turns and their receipts, the brief and its support judge, and the comic panels. muse-image-1.0 draws the comic panels.

The model never decides what is stored, what is public, or what is deleted. Those rules are code. Every claim and every brief quote is checked by string match in code against the turn it names, and a second, separate judge call reports whether each brief quote backs its line.

## In the build

The code was written by coding agents from specification files kept outside the repository, one agent for each owned path in each wave. The plan calls for a human to review the contracts, the meeting state machine, the row security policies and the scrub rules before they merge (IMPLEMENTATION.md, section 8). The ownership table is in `docs/ownership.md`.

## What we recorded

Replay fixtures are model replies recorded from real calls with `LLM_MODE=record`. They live in `packages/evals/fixtures/model-replies`, and the golden path (`pnpm golden-path --mock`) and the eval (`pnpm eval --replay`) replay them. They were recorded from Muse Spark on 27 Oct 2026: the golden path with `--record`, which skips the quiz as `--mock` does, and eval pair 3 on its own. Tests that need a reply the real model would not give, such as a judge that fails, read hand-written replies from `packages/evals/fixtures/scripted-replies` instead. Nothing in the demo runs on a fake model: `LLM_MODE=live` is set in production, and production refuses `replay`.

## What the numbers mean

The eval table in the README is produced by `pnpm eval` on the deployed system. Each row shows its sample size. The targets in ARCHITECTURE.md are targets, not results; a target that a run misses is reported as missed.
