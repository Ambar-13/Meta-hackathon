Request build-w1-ingest-001. File: apps/api/src/server.ts (api-shell). Change wanted:
```diff
+import { registerSourcesRoutes } from "./sources/index.js";
@@
-  // slot 2: registerSourcesRoutes from "./sources/index.js", added by ingest through a request
+  await registerSourcesRoutes(app, deps);
```
The slot line sits inside `registerAllRoutes`, indented two spaces, and the new line keeps that indent. The import line goes at the top of the imports (seams S2). Why: the golden path's steps 2 and 4 call POST /api/sources, GET /api/sources/:id and POST /api/sources/:id/names-review on the running api; the integration tests of this branch mount the routes through buildTestApp and do not need it. Until then: the routes exist only in tests.

Resolved at merge, 26 Oct: applied on main with the ingest merge (server.ts slot 2).
