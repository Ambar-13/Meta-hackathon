Request build/w2-comic-004. File: apps/api/src/server.ts. Change wanted:

```diff
+import { registerComicsRoutes } from "./comics/index.js";
...
-  // slot 9: registerComicsRoutes from "./comics/index.js", added by comic through a request
+  await registerComicsRoutes(app, deps);
```

The import line goes after the meeting-stream import on line 16. The `await registerComicsRoutes(app, deps);` line replaces the slot 9 comment inside registerAllRoutes, at that comment's indentation, between the meeting-stream line and the slot 10 comment.

Why: golden path step 14 posts to POST /api/meetings/:id/comic and reads GET /api/comics/:id/panels/:position, so the three comic routes must be mounted on the server. Tests W2-COMIC-T12 to T15 register the plugin themselves through buildTestApp and do not need this line.

Until then: the comic routes are not mounted on the server started from main, so the comic screen shows the picker and a request is answered with a 404. No value is used.
