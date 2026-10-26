Request build/w0-contracts-010.
File: docs/architecture/OVERVIEW.md, docs/architecture/STATES.md and docs/architecture/SAFETY.md, which are missing.
Change wanted: IMPLEMENTATION.md section 8 gives these files to deploy-and-docs in Wave 2. But the architecture-docs check reports a missing file as an error, because "docs" is on the passed list. The integrator either writes these three files in Wave 0, or removes the three rows from REQUIRED_DOCUMENTS in scripts/checks/architecture-docs.ts until Wave 2. This builder changed only the STATES.md stateDiagram count, from 4 to 6, as the spec's table gives it.
Why: pnpm checks, architecture-docs, reports three errors: is missing.
Until then: the three files are absent. pnpm checks reports three errors here.
Resolved at the Wave 0 freeze, 26 Oct: style-checked-paths.json lists the four Wave 0 docs files instead of docs, so missing architecture docs are warnings until Wave 2.
