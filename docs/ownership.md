# Ownership: which builder owns which path, by wave

Dated per wave. Copied from IMPLEMENTATION.md section 8, with two rows this spec adds. A path appears under exactly one builder per wave.

| Path | Wave 0 | Wave 1 | Wave 2 | Wave 3 | After 29 Oct |
|---|---|---|---|---|---|
| `packages/contracts/**` | contracts-author | integrator via `requests/` | integrator | integrator | CODEOWNERS |
| `packages/db/migrations/0001_foundation.sql`, `ranges.txt`, `global-tables.txt` | contracts-author | frozen (ranges appended by database) | frozen | frozen | CODEOWNERS |
| `packages/db/**` (rest) | | database | database (`0002+` by request) | database by request | CODEOWNERS on migrations |
| `packages/receipts/**` | contracts-author | frozen | frozen | frozen | |
| `packages/llm/src/modes.ts`, `ledger.ts`, `call-sites.ts` | contracts-author | dossier | frozen | real-wire (`config.ts` only) | |
| `packages/llm/**` (rest) | | dossier | frozen | real-wire (`config.ts` only) | |
| `packages/parsers/**`, `packages/scrub/**`, `apps/api/src/sources/**`, `apps/web/src/extract/**` | | ingest | frozen | phone-fixes (`extract` only) | CODEOWNERS on scrub |
| `apps/worker/src/cards/**`, `apps/api/src/cards/**` | | dossier | frozen | | |
| `apps/worker/src/quizzes/**`, `apps/api/src/quizzes/**` | | quiz | frozen | | |
| `apps/worker/src/meetings/**`, `apps/api/src/meetings/**` | | meeting-engine | frozen | stream-fixes (worker meetings only) | CODEOWNERS on `apps/worker/src/meetings` |
| `apps/api/src/server.ts`, `src/sessions/**`, `src/pairs/**`, `src/meeting-stream/**`, `src/web-pages/**`, `src/testing/**` | | api-shell | frozen | stream-fixes (`meeting-stream` only) | |
| `apps/web/**` except `src/extract/**` | | web-shell | briefs, comic, share-and-consent, deletion each own one `screens/` folder | phone-fixes | |
| `apps/worker/src/briefs/**`, `apps/api/src/briefs/**` | | | briefs | | |
| `apps/worker/src/comics/**`, `apps/api/src/comics/**` | | | comic | | |
| `apps/api/src/share/**` | | | share-and-consent | | |
| `apps/worker/src/retention/**` | | | deletion | | |
| `packages/prompts/*/v1/schema.json` | contracts-author | frozen | frozen | frozen | |
| `packages/prompts/<name>/**` (prompt.md, README, CHANGELOG, cases) | | the builder named in section 3 per prompt | the builder named per prompt | frozen | |
| `packages/prompts/src/current.ts` | | dossier | briefs | frozen | |
| `packages/evals/**` except `fixtures/model-replies/**` | | | evals | | |
| `packages/evals/fixtures/model-replies/**` | | each builder writes its own call sites | same | real-wire overwrites all | |
| `render.yaml`, Dockerfiles, `scripts/release.sh`, `docs/**` except `evidence/`, root `README.md`, CI jobs | contracts-author (CI skeleton, `scripts/checks/`, `docs/contracts.md`, `docs/ownership.md`, `docs/GLOSSARY.md` v1) | | deploy-and-docs | real-wire (Render env only) | |
| `scripts/golden-path.ts`, `tests/journeys/**` | | Ambar | Ambar | real-wire | |
| `requests/**` | anyone writes, never edits another's | | | | |
| `apps/worker/src/runner.ts`, `apps/worker/src/testing/**`, `apps/worker/README.md` | | dossier [confirm] | | | |
| `packages/db/src/testing/**` | | database | | | |

The two added rows are marked `[confirm]`: the worker runner and its test helpers go to dossier in Wave 1, because dossier owns the boot self-test the runner calls. IMPLEMENTATION.md section 3 leaves those paths without a Wave 1 owner.
