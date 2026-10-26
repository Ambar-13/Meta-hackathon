Request build/w6-directory-web-003. File: apps/web/README.md. Change wanted:

```diff
-- src/screens: one folder per screen; brief, comic, share and settings are placeholders until Wave 2.
+- src/screens: one folder per screen; the card screen's Sharing section holds the friends, directory and dating switches and the public items, and the directory screen lists the people who opted in and starts a meeting with one.
```

Why: the README says what each part of the app does, and this branch filled the directory screen and added the card screen's Sharing section (design section 7); apps/web/README.md is not in this builder's paths. No test needs it.

Until then: the line stays as it is.
