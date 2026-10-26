# Request build/w2-deploy-and-docs-004: secretlint ignore list

Request build/w2-deploy-and-docs-004. File: .secretlintignore.

Change wanted:

```diff
 node_modules/
 dist/
 coverage/
 pnpm-lock.yaml
 .git/
+packages/scrub/fixtures/
+packages/scrub/src/scrub.limits.unit.test.ts
+packages/scrub/src/secret-patterns.unit.test.ts
```

Why: the secrets job in .github/workflows/secrets.yml runs `pnpm exec secretlint "**/*"` and reports planted secrets in packages/scrub/fixtures (planted-secrets.ndjson, fenced-env.md) and two scrub test files on the current main; those are synthetic test data, and the rules must still run on every other file.

Until then: the secrets job fails on the scrub fixtures and test files. The workflow file is complete; only this ignore list is missing..
