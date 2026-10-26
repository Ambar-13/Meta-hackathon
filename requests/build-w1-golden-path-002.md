# Request build/w1-golden-path-002

File: scripts/tsconfig.json (new file)

Change wanted:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["golden-path.ts", "golden-path/*.ts"]
}
```

Why: the typed ESLint rules need a TypeScript project for every file. The golden-path files are in no project today. The `allowDefaultProject` list in eslint.config.js cannot cover them: typescript-eslint refuses a `**` glob there, and it caps the default-project files at 20, which the scripts/checks files already use up. This tsconfig covers only the golden path, so scripts/checks keeps its existing default-project path. With it, `pnpm lint` reports no error on scripts/golden-path.ts and scripts/golden-path/ (checked with this file in place). The test that needs it is the lint acceptance of every step file, including the unit test files R8.1-T1 and A7-T1.

Until then: `pnpm lint` reports a parsing error on each golden-path file, and the step is blocked on lint for those files. No code value depends on it.

Resolved at merge, 26 Oct: applied on main with the golden-path merge.
