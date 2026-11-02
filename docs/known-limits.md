# What Meet First does not do

A simulation of how two people would probably react, not a guarantee; it gives no score.

For adults only: Meet First is for people 18 and over, as the Meta terms and the hackathon require.

No sexually explicit questions: dating and romance questions are allowed, but the question check refuses anything that asks for sexual content.

The dating switch rests on the question check: a model reads each typed question and says whether any part of it is romantic, and a question worded to hide that can still reach a listed persona whose owner left the switch off.

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
- The upload reads Codex sessions saved as plain .jsonl files. Codex keeps older sessions compressed as .jsonl.zst, and the upload skips those, so a person who zips their sessions folder gets only the plain ones read (`apps/web/src/extract/zip-stream.ts`).
- One Codex session log can run to tens of megabytes, so even a week of sessions can zip to more than the 150 MB file limit (D2), and a person may need to pick fewer sessions at a time.

## Plain sentences for the code

- app_api can read every queued job payload and can add a job of any task name, because the queue lives in the `graphile_worker` schema that the api role can reach.
- A crash between a route's commit and its enqueue leaves that job unqueued; the enqueue runs after the commit in `apps/api/src/job-queue.ts`.
- trustProxy is 1, which assumes one proxy hop in front of the api on Render; the setting lives in `apps/api/src/server.ts`.
- A URL password longer than 1,024 characters is caught only by the entropy rule; the limit lives in `packages/scrub/src/secret-patterns.ts`.
- A secret value of 1 to 3 characters after a name such as PASSWORD= stays visible, because the scrubber hides values of 4 or more; the rule lives in `packages/scrub/src/secret-patterns.ts`.
- A recording in `packages/evals/fixtures/model-replies` answers only its exact request, so a change to a prompt, a card or the golden path's choices makes replay miss. Record again after one: `pnpm golden-path --record` on a fresh database, then the eval's replay pair on its own.
- The golden path's quiz is never recorded for replay. A judged quiz cannot be replayed, and its misses would change A's meeting prompt.
- The model still writes a line such as "I'll search my notes" before a tool call in most rounds. The worker leaves that round out of the turn and drops its text from the screen when the round ends, so a live viewer can see the line for a moment before it goes (`apps/worker/src/meetings/step-job.ts`).
- The Render service's environment holds every secret, because its start script migrates and starts both processes. The script runs as root and starts the api and the worker as two users of their own, each with only its own variables and its own home and temporary folder, so neither can read the other's environment or the script's, or plant a module the other would load (`scripts/start-api-and-worker.sh`, `Dockerfile.render`). The two-user start has not run outside Render's first deploy: this machine has no Docker.
- On Render's free plan the one service sleeps after 15 minutes with no visits, and the first visit after that waits about a minute on Render's loading page. A pinger that reads /api/health every 10 minutes keeps it awake within the 750 free hours a month. The free database expires 30 days after it is made (render.com/docs/free).
- On Render's free plan the service cannot set a shutdown delay (Render refuses maxShutdownDelaySeconds there), so a deploy stops it after Render's default wait, and a model call still running then is cut; the stalled-meeting sweep picks the meeting up again. A paid plan takes the 150 s delay (D70, R12.4).
- On Render the api and the worker share one container's 512 MB, so MAX_CONCURRENT_MEETINGS is 5 there; one replay meeting took the two to 368 MB together (render.yaml).
- On Render, app_migrate owns the public schema and keeps its app_definer membership (ADMIN and SET, no INHERIT) between deploys, because the pre-deploy migrate runs on every deploy and migration 0007 drops functions owned by app_definer. A local rebuild takes the membership back after each run (`packages/db/src/render-roles.ts`).
