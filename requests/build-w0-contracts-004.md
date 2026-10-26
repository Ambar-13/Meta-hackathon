Request build/w0-contracts-004.
File: packages/llm/src/ledger.ts and packages/llm/package.json.
Change wanted: the three ledger functions need the Kysely types and the sql template. The spec names Kysely but gives no version. The integrator picks a pinned version and adds it to packages/llm/package.json. Then add startLedgerRow(trx, start), finishLedgerRow(trx, id, finish), readLedgerWindow(db, seconds), readUsdSince(db, since) and readMeetingTokens(db, meetingId) as section 4.7.2 gives them.
Why: test R3.5-T1 (LedgerStart has exactly its seven fields, and startLedgerRow is a function of length 2) needs startLedgerRow. The test is not written.
Until then: ledger.ts holds the LedgerStart and LedgerFinish types only. It imports nothing from kysely.
Resolved at the Wave 0 freeze, 26 Oct: packages/llm/src/ledger.ts has LedgerTable, Database and the five functions; kysely 0.27.4 is a dependency.
