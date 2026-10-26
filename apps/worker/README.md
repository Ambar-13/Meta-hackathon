# @meet-first/worker

The background worker. It starts Graphile Worker with every job of the product after it has checked the environment, refused replay in production, checked the database schema version and run the model self-test.

## What this does

The background worker. It starts Graphile Worker with every job of the product after it has checked the environment, refused replay in production, checked the database schema version and run the model self-test.

## What this never does

It never serves a web route, never runs a migration, never starts when the self-test refuses a schema, and never registers a task that a feature folder does not export.

## How it fits

```mermaid
flowchart LR
  A[workerEnv.parse] --> B[assertWorkerModeAllowed] --> C[assertSchemaVersion] --> D[runBootSelfTest] --> E[graphileTaskList] --> F[run]
```

Notice that the self-test runs before any task is registered, so a bad schema stops the worker at boot, not mid-meeting.

## The main pieces

`src/runner.ts` holds the boot order, the task slots and the crontab filter. `src/job-context.ts` builds the context every job gets, the payload wrapper and the enqueue. `src/cards/` holds the names pass (`scrub-names-job.ts`), the card build (`build-card-job.ts`), the sampler, the quote check and the request builders. `src/testing/` holds the test runner, the fake clock, the recorded reply helpers, the fixture cases and the golden path rules.

## How to test it

`pnpm test:unit apps/worker/src` and `pnpm test:integration apps/worker/src/cards`.

Not built yet: quizzes, meetings, briefs, comics, retention task lists; each lands with its builder.
