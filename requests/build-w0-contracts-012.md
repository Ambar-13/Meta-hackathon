Request build/w0-contracts-012.
File: eslint.config.js and the copied scripts/checks/*.ts files (a decision for the integrator).
Change wanted: the spec's lint config sets projectService: true. That cannot type-check scripts/checks/*.ts or vitest.workspace.ts, because no tsconfig includes them. The builder set the parser option to allowDefaultProject for those files, with defaultProject tsconfig.base.json and a file-count limit of 20, so the copied Makelet scripts get strict settings. The other option is a scripts/tsconfig.json, which the owned list does not name. Also changed, for lint only, with no change in behaviour: String() around two numbers in one template literal in architecture-docs.ts, and one parameter renamed from _all to whole in strip-comments.ts.
Why: pnpm lint must pass, and it does with these settings.
Until then: lint passes with these settings.
Resolved at the Wave 0 freeze, 26 Oct: Accepted as written; eslint also allows snake_case type properties for row types.
