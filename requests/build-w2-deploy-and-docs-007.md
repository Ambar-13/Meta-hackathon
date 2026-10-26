# Request build/w2-deploy-and-docs-007: app and worker build scripts

Request build/w2-deploy-and-docs-007. File: apps/api/package.json and apps/worker/package.json.

Change wanted:

```diff
 // apps/api/package.json
   "scripts": {
+    "build": "tsc -p tsconfig.json",
     "typecheck": "tsc --noEmit -p tsconfig.json",
     "start": "tsx src/server.ts"
 // apps/worker/package.json (the same line, with its own tsconfig.json)
   "scripts": {
+    "build": "tsc -p tsconfig.json",
     "start": "tsx src/runner.ts",
```

The api tsconfig already sets rootDir to src and outDir to dist, so this emits dist/server.js. The worker tsconfig must be checked for the same settings before the change is merged; the proposal is a proposal.

Why: Dockerfile.api runs `pnpm --filter @meet-first/api build` and starts `node apps/api/dist/server.js`; Dockerfile.worker does the same with the worker and dist/runner.js. Neither package has a build script today, so the image build cannot succeed. Docker is not installed here, so the image build is not run.

Until then: the Dockerfiles name the package filters `@meet-first/web`, `@meet-first/api` and `@meet-first/worker` (the names the packages declare). The web build exists (`vite build`). The api and worker start from source with tsx until this request is applied..
