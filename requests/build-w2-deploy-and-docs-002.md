# Request build/w2-deploy-and-docs-002: docs-architecture check list

Request build/w2-deploy-and-docs-002. File: scripts/checks/style-checked-paths.json.

Change wanted:

```diff
   "paths": [
     "apps",
     "packages",
     "scripts",
     "tests",
-    "docs/contracts.md",
-    "docs/ownership.md",
-    "docs/GLOSSARY.md",
-    "docs/README-TEMPLATE.md"
+    "docs"
   ]
```

Why: test W2-DEPLOY-T12 needs a missing docs/architecture/OVERVIEW.md, STATES.md or SAFETY.md to fail `pnpm checks`; style-scope.ts makes a finding a warning unless its path is on this list (as-built item 24 asks for this change in the change that adds docs/architecture).

Until then: those three missing files are only warnings, so T12 fails for them. The architecture documents are present in this worktree and `pnpm checks` passes..
