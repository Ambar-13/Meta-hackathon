Request build/w0-contracts-007.
File: pnpm-lock.yaml at the repository root.
Change wanted: add pnpm-lock.yaml to the Wave 0 owned list. pnpm install creates it. The CI jobs run pnpm install --frozen-lockfile, which fails without a committed lock file.
Why: the CI workflows (typecheck, lint-and-checks, tests, secrets and daily-live-self-test) cannot run without it.
Until then: the lock file exists in the worktree because the acceptance step pnpm install created it. This builder does not commit it.
Resolved at the Wave 0 freeze, 26 Oct: pnpm-lock.yaml is committed.
