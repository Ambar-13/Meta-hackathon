Request build/w2-share-and-consent-003. File: scripts/tsconfig.json. Change wanted:

```diff
-  "include": ["golden-path.ts", "golden-path/*.ts"]
+  "include": ["golden-path.ts", "golden-path/*.ts", "share-takedown.ts"]
```

Why: `pnpm lint` fails on scripts/share-takedown.ts with "Parsing error: ... was not found by the project service. Consider either including it in the tsconfig.json or including it in allowDefaultProject". The file is in the typed-lint project only when this tsconfig lists it. The acceptance command `pnpm lint` cannot pass without this line. Every other check (typecheck, the three test kinds, the web build, `pnpm checks`) passes on this branch.

Until then: the script is written, runs, and is tested, but it is not lint-checked. `pnpm lint` reports that one parse error and nothing else. No value is used.
