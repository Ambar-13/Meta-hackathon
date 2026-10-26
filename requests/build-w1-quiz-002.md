Request build/w1-quiz-002. File: apps/api/src/server.ts. Change wanted:

```diff
+import { registerQuizRoutes } from "./quizzes/index.js";
-// slot 4: registerQuizRoutes from "./quizzes/index.js", added by quiz through a request
+await registerQuizRoutes(app, deps);
```

The import line goes first in the file's import block. The call line replaces the slot 4 comment at that comment's indentation.

Why: the golden path reaches the three quiz routes only through server.ts, so the golden path needs this line. The quiz route tests (for example R4.2-T1) do not need it, because they pass the routes to buildTestApp directly.

Until then: the quiz routes are mounted only in the quiz builder's tests. No value is used.

Resolved at merge, 26 Oct: applied on main with the quiz merge.
