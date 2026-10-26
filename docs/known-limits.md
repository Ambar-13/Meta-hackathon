# What Meet First does not do

No prediction of whether a relationship succeeds.

No compatibility score.

A matching quote proves provenance, not truth.

Automated scrubbing is not perfect.

A user can lie or paste someone else's writing.

Prompt injection cannot be eliminated when untrusted text enters a model context.

An anonymous session cannot be recovered once device and recovery code are both lost.

## Things we can only detect, not prevent

- Render body limit (R1.8): a request over the platform's body limit is detected, not prevented.
- Authorship (R2.7): a report that someone else wrote the chats is detected after the fact; the attestation tick is the person's own word.
- Marker repetition under injection (R7.4): repeated markers are detected, not stopped.
- Postgres disk (R12.5): a full disk is detected, not prevented.
- Backups (R12.7): backups belong to the hosting platform, and this product does not test a restore.

## Operational limits

- A job that spends all its attempts leaves its step for the sweeper or leaves the brief unwritten.
- The daily and total USD caps pause model calls for the rest of the day. Cards show "card generation paused for today" and meetings show "meetings are paused for today" (packages/llm/src/caps.ts).
- Comics are purged after 30 days unless their share page is published.
- A meeting may run for about 13 minutes, while the copy says ten (PLAN.md 10.6).

## Plain sentences for the code

- app_api can read every queued job payload and can add a job of any task name, because the queue lives in the `graphile_worker` schema that the api role can reach.
- A crash between a route's commit and its enqueue leaves that job unqueued; the enqueue runs after the commit in `apps/api/src/job-queue.ts`.
- trustProxy is 1, which assumes one proxy hop in front of the api on Render; the setting lives in `apps/api/src/server.ts`.
- A URL password longer than 1,024 characters is caught only by the entropy rule; the limit lives in `packages/scrub/src/secret-patterns.ts`.
- A secret value of 1 to 3 characters after a name such as PASSWORD= stays visible, because the scrubber hides values of 4 or more; the rule lives in `packages/scrub/src/secret-patterns.ts`.
- Every recorded model reply is hand-written until Wave 3 records them; the fixtures live in `packages/evals/fixtures/model-replies`.
- The api's environment holds the app_migrate URL, because Render gives the pre-deploy migrate the service's own variables; a one-off migrate job of its own would take it out of the api (render.yaml).
