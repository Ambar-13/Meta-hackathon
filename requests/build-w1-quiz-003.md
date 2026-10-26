Request build/w1-quiz-003. File: apps/worker/src/runner.ts. Change wanted:

```diff
+import { quizTasks } from "./quizzes/index.js";
-// slot 2: quizTasks from "./quizzes/index.js", added by quiz through a request
+...quizTasks,
```

The import line goes first in the file's import block. The `...quizTasks,` line replaces the slot 2 comment inside the task list, at that comment's indentation, in the same form as the slot 1 line `...cardTasks,`.

Why: the golden path needs Graphile to find the answer_quiz and judge_quiz tasks, so the golden path needs this line. Tests R4.1-T4 and R4.4-T1 call the tasks directly and do not need it.

Until then: the quiz jobs run only in the quiz builder's tests. No value is used.

Resolved at merge, 26 Oct: applied on main with the quiz merge.
