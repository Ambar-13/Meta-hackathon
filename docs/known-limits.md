# What Meety does not do

A simulation of how two people would probably react, not a guarantee; it gives no score.

No age check: the site does not ask anyone's age.

Invite-only on the deployed site: sign-up with a name needs the access code (ACCESS_CODE on the Render service), so a script cannot make accounts and spend the model budget through them. Continue with Google needs no code, since a script cannot make Google accounts at will; it shows only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on the service, and allows 60 sign-ins per address per hour. A link with ?access= fills the code in, and the invite link a person shares carries the code they signed up with. Wrong codes count toward the 10 accounts per address per hour. If the code leaks, the spend caps still hold: $15 a day and $111 in all on Render (render.yaml).

No sexually explicit questions: dating and romance questions are allowed, but the question check refuses anything that asks for sexual content.

The dating switch rests on the question check: a model reads each typed question and says whether any part of it is romantic, and a question worded to hide that can still reach a listed persona whose owner left the switch off.

No compatibility score.

A matching quote proves provenance, not truth.

Automated scrubbing is not perfect.

A user can lie or paste someone else's writing.

Prompt injection cannot be eliminated when untrusted text enters a model context.

An anonymous session cannot be recovered once device and recovery code are both lost.

## Friends and Meety

- Meety, your personal AI (the orchestrator in the code), only proposes. A model reads your message, your friend list and your last few messages, and suggests one help search, one friend ask or a reply in words; code then checks the friend and the question, and only your press on the reply starts an ask. It can misread what you meant, so its reply says what it will ask before you press.
- Help searches reach only people listed in Explore. A friend who is not listed is reached only by a friend ask, because friends switched on "friends can ask how I would react", not "answer people's problems".
- Two friends with the same display name cannot be told apart in the chat; the Friends page asks each one by their own button.
- A declined friend request can be sent again at once, inside the 20 requests a day, as on Instagram.
- People share posts, stories and likes, but their Meety does not read them yet, and a Meety does not write posts of its own. The sample people's posts are written by hand in `packages/db/src/samples/sample-people.ts`.
- The sample people are made up, and every place that shows one marks it Sample. Nobody can sign in as one: each was made with a random session and recovery code that were never kept. Setting `SEED_SAMPLES` to `0` stops adding them but does not remove the ones already there; removing them needs a delete of those people by hand.
- A sample person accepts every friend request at once, so friending one costs nothing but a slot of the 20 requests a day. Asking their agent costs model calls like any friend ask, inside the same daily caps.
- Your AI's summary is written by your own ChatGPT or Claude from the prompt Meety gives (packages/prompts/summary-request). Meety looks each of its quotes up word for word in your own uploaded messages; a point whose words it cannot find stays a "likely" line, said as never having come up in your chats. That prompt is a draft until it has been run in ChatGPT and in Claude.
- A friend's ask uses your summary only while its "Friends' asks can use my summary" switch is on; Try your Meety always uses it. A friend with no approved card can be asked once their summary is checked and that switch is on; once there is an approved card, the card's own switch decides.
- An upload keeps the order of your messages, not the time each was written, so when two of your messages disagree, the later one in the upload wins.
- Message numbers repeat across uploads, so a summary point or a search result whose number another upload already uses is left out of that answer.
- A friend ask turns the question into the words you would have used (packages/prompts/search-words) only when your card lets friends search your messages; when that call fails, the search uses the question's own words. A card with at most 40 messages skips the search result and shows them all, though the search-words call still runs. Past 40, the answer sees the search's hits and the longest message of each of 30 stretches of the file.
- When nothing speaks to a friend's question, the answer is a guess from who the person is, close or rough, and it says so in its first sentence. A guess can be wrong; its quote shows what it rests on, not the prediction. It stays "has not said" on sensitive topics, plain facts of someone's life, and topics the quiz showed were a wrong guess.
- After a deploy the old server keeps taking jobs for about four minutes (5 Nov: new worker up at 06:15:53, first job on it at 06:20:00), so an answer in that window comes from the old code.
- A friend can ask how someone would react to a date, and the answer is a guess that says what they would ask first and leaves the yes or no to them. Friend asks do not read the dating switch, which covers Explore only: the friends switch and the copy of every answer are what stand behind them.
- Nothing in the app checks age. A date guess stops when the ask or a line shows someone is under 18, and a person who shows it nowhere looks like anyone else.
- The persona answer prompt (persona-answer v6) is a draft (packages/prompts/persona-answer/results.md).
- Text typed into your own uploaded messages in a placeholder's shape, such as [person:...], is not turned round before the names check as it is in a pasted summary, so a name written inside one is not replaced.
- The prompt behind Meety (orchestrator v5) is a draft (packages/prompts/orchestrator/results.md).

## Things we can only detect, not prevent

- Render body limit: a request over the platform's body limit is detected, not prevented.
- Authorship: a report that someone else wrote the chats is detected after the fact; the attestation tick is the person's own word.
- Marker repetition under injection: repeated markers are detected, not stopped.
- Postgres disk: a full disk is detected, not prevented. /api/health reports degraded at 80% of DATABASE_DISK_BYTES, the database plan's disk (1 GB on the free plan), so a move to a paid database needs its size set there.
- Backups: backups belong to the hosting platform, and this product does not test a restore.

## Operational limits

- A job that spends all its attempts leaves its step for the sweeper or leaves the brief unwritten.
- The daily and total USD caps pause model calls for the rest of the day. Cards show "card generation paused for today" and meetings show "meetings are paused for today" (packages/llm/src/caps.ts).
- Comics are purged after 30 days unless their share page is published.
- A meeting may run for about 13 minutes, while the copy says ten.
- The upload reads Codex sessions saved as plain .jsonl files. Codex keeps older sessions compressed as .jsonl.zst, and the upload skips those, so a person who zips their sessions folder gets only the plain ones read (`apps/web/src/extract/zip-stream.ts`).
- One Codex session log can run to tens of megabytes, so even a week of sessions can zip to more than the 150 MB file limit, and a person may need to pick fewer sessions at a time.

## Plain sentences for the code

- app_api can read every queued job payload and can add a job of any task name, because the queue lives in the `graphile_worker` schema that the api role can reach.
- A crash between a route's commit and its enqueue leaves that job unqueued; the enqueue runs after the commit in `apps/api/src/job-queue.ts`.
- trustProxy is 1, which assumes one proxy hop in front of the api on Render; the setting lives in `apps/api/src/server.ts`.
- A URL password longer than 1,024 characters is caught only by the entropy rule; the limit lives in `packages/scrub/src/secret-patterns.ts`.
- A secret value of 1 to 3 characters after a name such as PASSWORD= stays visible, because the scrubber hides values of 4 or more; the rule lives in `packages/scrub/src/secret-patterns.ts`.
- A recording in `packages/evals/fixtures/model-replies` answers only its exact request, so a change to a prompt, a card or the golden path's choices makes replay miss. Record again after one: `pnpm golden-path --record` on a fresh database, then the eval's replay pair on its own.
- The recordings of persona_answer and orchestrator calls predate persona-answer v6 and orchestrator v5, so a golden path replay misses at those steps until they are recorded again, which needs a key that can reach the models.
- The golden path's quiz is never recorded for replay. A judged quiz cannot be replayed, and its misses would change A's meeting prompt.
- The model still writes a line such as "I'll search my notes" before a tool call in most rounds. The worker leaves that round out of the turn and drops its text from the screen when the round ends, so a live viewer can see the line for a moment before it goes (`apps/worker/src/meetings/step-job.ts`).
- The Render service's environment holds every secret, because its start script migrates and starts both processes. The script runs as root and starts the api and the worker as two users of their own, each with only its own variables and its own home and temporary folder, so neither can read the other's environment or the script's, or plant a module the other would load (`scripts/start-api-and-worker.sh`, `Dockerfile.render`). The two-user start has not run outside Render's first deploy: this machine has no Docker.
- On Render the api and the worker share one container's 2 GB. MAX_CONCURRENT_MEETINGS is still 5 there: it was set for 512 MB, where one replay meeting took the two to 368 MB, and the 2 GB plan has not been measured.
- The start script migrates, so a plan change or deploy that starts while Postgres restarts fails with ECONNREFUSED. Render keeps the running instance, and nothing changes until it is tried again, so change one plan at a time.
- On Render, app_migrate owns the public schema and keeps its app_definer membership (ADMIN and SET, no INHERIT) between deploys, because the pre-deploy migrate runs on every deploy and migration 0007 drops functions owned by app_definer. A local rebuild takes the membership back after each run (`packages/db/src/render-roles.ts`).
