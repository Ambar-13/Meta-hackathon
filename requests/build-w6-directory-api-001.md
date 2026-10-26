Request build/w6-directory-api-001. File: apps/api/README.md. Change wanted:

```diff
 - `src/meeting-stream/`: the LISTEN connection, the stream and the poll fallback.
+- `src/directory/`: a card's sharing settings, the directory and your own listing, meetings with a listed persona, and the friends list.
 - `src/web-pages/`: the web build, the app-shell fallback, the CSP header and `/api/health`.
```

Why: repo rule 2 lists each main piece of an app in its README, and `apps/api/src/directory/` is a new folder of the api. No test needs it. Until then: the api README does not name the folder.
