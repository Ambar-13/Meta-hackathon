Request build/w2-briefs-002. File: apps/api/src/server.ts. Change wanted:

```diff
+import { registerBriefsRoutes } from "./briefs/index.js";
-// slot 8: registerBriefsRoutes from "./briefs/index.js", added by briefs through a request
+await registerBriefsRoutes(app, deps);
```

The import line goes first in the file's import block. The `await registerBriefsRoutes(app, deps);` line replaces the slot 8 comment inside registerAllRoutes, at that comment's indentation, after the slot 7 line `await registerMeetingStreamRoutes(app, deps);`.

Why: GET /api/meetings/:id/brief must be reachable for the brief screen and for golden path step 13. My integration test registers registerBriefsRoutes on its own test app, so it does not need this line.

Until then: the brief route is not registered in a running api, so the brief screen gets no brief. No value is used.
