import { z } from "zod";
import { Uuid } from "../primitives.js";

// Every background job name, in the order of IMPLEMENTATION.md 2.3.
export const JOB_NAMES = [
  "scrub_names", "build_card", "check_question", "answer_quiz", "judge_quiz", "meeting_step",
  "write_briefs", "render_comic", "delete_person", "sweep_stalled", "purge_expired",
] as const;
// One job name, checked against the list above.
export const JobName = z.enum(JOB_NAMES);
// The type of JobName, read from the schema above.
export type JobName = z.infer<typeof JobName>;
// The payload each job takes, by job name. Each carries the id its context needs before the first read (D55):
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
} as const;
// The parsed payload of one job, by job name.
export type JobPayload<N extends JobName> = z.infer<(typeof JobPayloads)[N]>;
// Adds one job. Both apps implement it the same way: JOB_MAX_ATTEMPTS[name] always, and no job key on any job (D45).
export type Enqueue = <N extends JobName>(name: N, payload: JobPayload<N>, options?: { runAt?: Date }) => Promise<void>;
// How many times each job may run before it fails. Every enqueue passes this value (IMPLEMENTATION.md 2.3).
// Values marked "default" in the spec are builder defaults for the Wave 0 review; D-row values are as the design gives.
export const JOB_MAX_ATTEMPTS = {
  scrub_names: 2, // D15
  build_card: 2, // R3.5
  check_question: 2, // default [confirm]
  answer_quiz: 2, // default [confirm]
  judge_quiz: 2, // default [confirm]
  meeting_step: 1, // D59
  write_briefs: 2, // default [confirm]
  render_comic: 1, // D64
  delete_person: 5, // default [confirm]
  sweep_stalled: 1,
  purge_expired: 1,
} as const satisfies Record<JobName, number>;
// The cron lines: sweep stalled meetings every minute, purge expired rows every hour, D46.
export const CRONTAB = "* * * * * sweep_stalled ?max=1\n0 * * * * purge_expired ?max=1\n";
// Milliseconds before a job tries again when the limiter window is full, D58.
export const LIMITER_RETRY_MS = 5_000;
// Jobs one worker runs at the same time, D57.
export const WORKER_CONCURRENCY = 16;
// Seconds without an event before a running meeting counts as stalled, D46.
export const SWEEP_STALLED_SECONDS = 150;
// Seconds without a heartbeat before the worker counts as down, ARCHITECTURE.md 3.25.
export const WORKER_HEARTBEAT_STALE_SECONDS = 120;
