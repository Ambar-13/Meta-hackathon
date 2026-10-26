Request build/w0-contracts-008.
File: apps/web, apps/api, apps/worker, packages/db, packages/parsers, packages/scrub, packages/prompts and packages/evals, each with a package.json, tsconfig.json and README.md, as section 5.10 describes.
Change wanted: section 5.10 asks for these placeholder packages. Section 3, the owned list, says nothing else may be touched, and it does not list them. Section 5.10 also says "pnpm -r typecheck passes with the three packages and no apps", which contradicts giving the eight folders typecheck scripts. The integrator decides: add these paths to the owned list, or drop the placeholders.
Why: section 5.10, and the checks that read READMEs of every package.
Until then: none of the eight is created. The typecheck passes for contracts, receipts and llm.
Resolved at the Wave 0 freeze, 26 Oct: Placeholder package.json and README.md for the seven Wave 1 packages, with the dependency sets of their specs and no scripts.
