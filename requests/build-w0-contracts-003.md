Request build/w0-contracts-003.
File: packages/contracts/src/operations/model-calls.ts and packages/llm/src/modes.ts. Test R3.1-T6 is not written.
Change wanted: move requestHash (sha256 of the key-sorted JSON of the body) into packages/contracts/src/operations/model-calls.ts, and have packages/llm/src/modes.ts re-export it. Contracts cannot import packages/llm: its tsconfig has rootDir src, and llm already depends on contracts, so the import would form a cycle.
Why: test R3.1-T6, which checks that the nine self_test fixtures are named by their request hash, needs requestHash inside packages/contracts. The test is not written, because importing packages/llm from contracts fails typecheck.
Until then: the nine fixtures under packages/evals/fixtures/model-replies/self_test/ are named with requestHash from packages/llm/src/modes.ts, the same function. R3.1-T6 is not written, so model-calls shows 5 of 6 tests.
Resolved at the Wave 0 freeze, 26 Oct: R3.1-T6 is in packages/llm/src/modes.unit.test.ts, so contracts stays free of node:crypto.
