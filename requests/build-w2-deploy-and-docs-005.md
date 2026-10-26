# Request build/w2-deploy-and-docs-005: api README

Request build/w2-deploy-and-docs-005. File: apps/api/README.md.

Change wanted:

```diff
-- It never calls the model, never imports `packages/llm` and never reads `META_API_KEY`.
+- It never calls the model, never imports `packages/llm` and never reads the model key.
```

Why: the forbidden-imports job (.github/workflows/forbidden-imports.yml) greps apps/api for the literal name META_API_KEY, and this README line contains it, so the grep step fails on the current main; the grep is the spec's and is not changed.

Until then: the META_API_KEY grep step fails on apps/api/README.md. No other file is affected..
