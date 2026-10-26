Request build/w2-share-and-consent-001. File: apps/api/src/server.ts. Change wanted:

```diff
 import { registerMeetingStreamRoutes } from "./meeting-stream/index.js";
+import { registerShareRoutes } from "./share/index.js";
 import { addContentSecurityPolicy, registerWebPagesRoutes } from "./web-pages/index.js";
```

```diff
   // slot 9: registerComicsRoutes from "./comics/index.js", added by comic through a request
-  // slot 10: registerShareRoutes from "./share/index.js", added by share-and-consent through a request
+  await registerShareRoutes(app, deps);
   await registerWebPagesRoutes(app, deps);
```

The import line goes after the meeting-stream import, and the `await` line replaces the slot 10 comment at the same indentation, as the slot names it (parent notes, item 4).

Why: the share routes (POST and DELETE /api/meetings/:id/consent, GET /api/share/:slug) are mounted by slot 10 only in the all-slots app, which the golden path step 15 and step 16 use. My tests mount `registerShareRoutes` themselves and never wait for the slot.

Until then: the share routes are not mounted in the all-slots app. No value is used. The public route GET /api/share/:slug is already in PUBLIC_ROUTES (routes.briefs.readShare has `public: true`), so no change to apps/api/src/sessions is needed.
