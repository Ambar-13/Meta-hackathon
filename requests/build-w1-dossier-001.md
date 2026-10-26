Request build-w1-dossier-001. File: apps/api/src/server.ts (api-shell). Change wanted:
```diff
+import { registerCardsRoutes } from "./cards/index.js";
@@
-  // slot 3: registerCardsRoutes from "./cards/index.js", added by dossier through a request
+  await registerCardsRoutes(app, deps);
```
The slot line sits inside `registerAllRoutes`, indented two spaces, and the new line keeps that indent. The import line goes at the top of the imports (seams S2). Why: the card routes are the running api's routes for POST /api/sources/:id/cards, GET /api/cards/:id, GET /api/cards/:id/items/:position/source and POST /api/cards/:id/approve; the golden path and check-wave-1 step 3 need them on the running api, and test R3.4-T1 reaches them through buildTestApp({ routes: [registerCardsRoutes] }) without this line. Until then: the card routes exist in tests only.
