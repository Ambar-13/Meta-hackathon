import { z } from "zod";
import { Uuid } from "../primitives.js";

// Every background job name.
export const JOB_NAMES = [
  "scrub_names",
  "build_card",
  "check_question",
  "answer_quiz",
  "judge_quiz",
  "meeting_step",
  "write_briefs",
  "render_comic",
  "delete_person",
  "sweep_stalled",
  "purge_expired",
  "run_ask",
  "orchestrate",
  "check_summary",
] as const;
// One job name, checked against the list above.
export const JobName = z.enum(JOB_NAMES);
// The type of JobName, read from the schema above.
export type JobName = z.infer<typeof JobName>;
// The payload each job takes, by job name. Each carries the id its context needs before the first read:
// personId for the jobs that run as one person, meetingId for the jobs that run inside one meeting.
export const JobPayloads = {
  scrub_names: z.object({ sourceId: Uuid, personId: Uuid }),
  build_card: z.object({ cardId: Uuid, personId: Uuid }),
  check_question: z.object({ meetingId: Uuid }),
  answer_quiz: z.object({ quizId: Uuid, personId: Uuid }),
  judge_quiz: z.object({ quizId: Uuid, personId: Uuid }),
  meeting_step: z.object({ meetingId: Uuid, stepSeq: z.number().int().min(1) }),
  write_briefs: z.object({ meetingId: Uuid }),
  render_comic: z.object({ comicId: Uuid, meetingId: Uuid }),
  delete_person: z.object({ personId: Uuid }),
  sweep_stalled: z.object({}),
  purge_expired: z.object({}),
  run_ask: z.object({ askId: Uuid, personId: Uuid }), // personId is the asker; the job reads each answering persona in that person's own context
  orchestrate: z.object({ messageId: Uuid, personId: Uuid }),
  check_summary: z.object({ personId: Uuid }), // personId owns the summary; the job runs as that person // messageId is the orchestrator's thinking reply; personId owns the thread
} as const;
// The parsed payload of one job, by job name.
export type JobPayload<N extends JobName> = z.infer<(typeof JobPayloads)[N]>;
// Adds one job. Both apps implement it the same way: JOB_MAX_ATTEMPTS[name] always, and no job key on any job.
export type Enqueue = <N extends JobName>(
  name: N,
  payload: JobPayload<N>,
  options?: { runAt?: Date },
) => Promise<void>;
// How many times each job may run before it fails. Every enqueue passes this value.
export const JOB_MAX_ATTEMPTS = {
  scrub_names: 2,
  build_card: 2,
  check_question: 2,
  answer_quiz: 2,
  judge_quiz: 2,
  meeting_step: 1,
  write_briefs: 2,
  render_comic: 1,
  delete_person: 5,
  sweep_stalled: 1,
  purge_expired: 1,
  run_ask: 2, // answers already written are kept, so a second run asks only the personas still pending
  orchestrate: 2, // a second run plans only a reply still thinking, so it never plans twice
  check_summary: 2, // a second run checks the summary as it stands then, from the start
} as const satisfies Record<JobName, number>;
// The cron lines: sweep stalled meetings every minute, purge expired rows every hour.
export const CRONTAB = "* * * * * sweep_stalled ?max=1\n0 * * * * purge_expired ?max=1\n";
// Milliseconds before a job tries again when the limiter window is full.
export const LIMITER_RETRY_MS = 5_000;
// Jobs one worker runs at the same time.
export const WORKER_CONCURRENCY = 16;
// Seconds without an event before a running meeting counts as stalled.
export const SWEEP_STALLED_SECONDS = 150;
// Seconds without a heartbeat before the worker counts as down.
export const WORKER_HEARTBEAT_STALE_SECONDS = 120;
