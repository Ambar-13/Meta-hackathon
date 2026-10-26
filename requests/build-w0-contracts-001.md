Request build/w0-contracts-001.
File: packages/contracts/src/cards/quiz-bank.ts (function sampleQuiz).
Change wanted: a decision on how one 64-bit SplitMix64 output becomes an index in the Fisher-Yates shuffle. The spec fixes the seed (the first 8 bytes of sha256 of the card id, read as an unsigned big-endian integer), the generator constants and the shifts, but not the index rule. Proposed, not applied and not used in code:
```diff
+  // index = Number(output % BigInt(i + 1)), for i from 29 down to 1, on the ids 1..30 in ascending order
```
Why: test D28-T2 and D28-T3 in packages/contracts/src/cards/quiz-bank.contracts.test.ts need sampleQuiz to return ten ids. The spec says the shuffle is "Fisher-Yates driven by that generator" and does not say how a 64-bit value maps to an index, so the integrator has to give the rule.
Until then: sampleQuiz throws ContractError quiz_sample_rule_missing and returns no sample. D28-T2 and D28-T3 fail.
Resolved at the Wave 0 freeze, 26 Oct: sampleQuiz is written: cards/seeded-sample.ts holds a dependency-free SHA-256 (checked against node:crypto) and SplitMix64; the index rule is output mod (i + 1), places 29 down to 1.
