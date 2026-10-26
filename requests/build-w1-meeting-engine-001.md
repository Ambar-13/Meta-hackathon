# Request build/w1-meeting-engine-001

File: `apps/api/src/server.ts` (owner: api-shell, Wave 1)

Change wanted:

```diff
+import { registerMeetingsRoutes } from "./meetings/index.js";
...
-  // slot 6: registerMeetingsRoutes from "./meetings/index.js", added by meeting-engine through a request
+  await registerMeetingsRoutes(app, deps);
```

Why: the meeting routes (create, read, ready, start) reach the app only through slot 6 of `server.ts` (seams S2). Test: every case of `apps/api/src/meetings/meeting-routes.integration.test.ts` runs through the full app once this slot is in place.

Until then: the meeting route tests pass the plugin to `buildTestApp({ routes: [registerMeetingsRoutes] })`, so they do not depend on this request. No value is used.
