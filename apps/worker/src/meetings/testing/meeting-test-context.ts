import type { Kysely } from "kysely";
import { ContractError, JobPayloads, type JobName } from "@meet-first/contracts";
import { withMeeting, type Database } from "@meet-first/db";
import { makeLlmClient } from "@meet-first/llm";
import { makeReplayFolder } from "@meet-first/llm/testing";
import type { JobContext } from "../../job-context.js";
import { fakeClock, makeTestJobContext, type EnqueuedJob } from "../../testing/index.js";
import { runCheckQuestion } from "../check-question-job.js";
import { runMeetingStep } from "../step-job.js";
import { runSweepStalled } from "../sweep-stalled-job.js";
import { withScriptedReplies, type ReplyScript, type ScriptedClient } from "./scripted-replies.js";

// The three jobs a meeting test may run by hand.
type MeetingJobName = "meeting_step" | "sweep_stalled" | "check_question";
// The meeting jobs in the order the drain lists them by default.
const MEETING_JOB_NAMES: readonly MeetingJobName[] = [
  "meeting_step",
  "sweep_stalled",
  "check_question",
];

// A meeting test's context: the job context, the fake clock it reads, the jobs it recorded and not yet run, the scripted client.
export type MeetingTestContext = {
  context: JobContext;
  clock: { now: () => Date; advance: (ms: number) => void };
  pending: EnqueuedJob[];
  client: ScriptedClient;
  fixtureRoot: string;
  close: () => Promise<void>;
};

// Builds the context over db with the script and a fake clock at clockStart. Without fixtureRoot the fixtures go to a temporary folder (a fake fixture folder).
export async function makeMeetingTestContext(options: {
  db: Kysely<Database>;
  script: ReplyScript;
  clockStart: Date;
  fixtureRoot?: string;
  killAfterReply?: { callSite: "receipts" | "speech" | "question_check"; times: number };
}): Promise<MeetingTestContext> {
  const clock = fakeClock(options.clockStart);
  const base = makeTestJobContext({ db: options.db, now: clock.now });
  const temporary = options.fixtureRoot === undefined ? await makeReplayFolder([]) : undefined;
  const fixtureRoot = options.fixtureRoot ?? temporary?.root ?? "";
  const llm = makeLlmClient({
    db: options.db,
    env: base.context.env,
    now: clock.now,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    fixtureRoot,
  });
  const client = withScriptedReplies(llm, options.script, {
    fixtureRoot,
    ...(options.killAfterReply === undefined ? {} : { killAfterReply: options.killAfterReply }),
  });
  const context: JobContext = { ...base.context, llm: client };
  return {
    context,
    clock,
    pending: base.enqueued,
    client,
    fixtureRoot,
    close: async () => {
      if (temporary !== undefined) await temporary.remove();
    },
  };
}

// Runs one of the three meeting jobs now, with its payload parsed by JobPayloads, as Graphile would.
export async function runMeetingJob(
  test: MeetingTestContext,
  name: MeetingJobName,
  payload: unknown,
): Promise<void> {
  if (name === "meeting_step") {
    await runMeetingStep(JobPayloads.meeting_step.parse(payload), test.context);
    return;
  }
  if (name === "sweep_stalled") {
    await runSweepStalled(JobPayloads.sweep_stalled.parse(payload), test.context);
    return;
  }
  await runCheckQuestion(JobPayloads.check_question.parse(payload), test.context);
}

// Runs recorded jobs that are due on the fake clock, earliest run_at first, until none is due or limit jobs ran; returns the jobs it ran in order.
export async function drainJobs(
  test: MeetingTestContext,
  options: { limit: number; names?: readonly JobName[]; stepGapMs?: number },
): Promise<EnqueuedJob[]> {
  const names = options.names ?? MEETING_JOB_NAMES;
  const ran: EnqueuedJob[] = [];
  while (ran.length < options.limit) {
    const job = nextDueJob(test, names);
    if (job === undefined || !isMeetingJobName(job.name)) break;
    test.pending.splice(test.pending.indexOf(job), 1);
    await runMeetingJob(test, job.name, job.payload);
    if (options.stepGapMs !== undefined && job.name === "meeting_step")
      test.clock.advance(options.stepGapMs);
    ran.push(job);
  }
  return ran;
}

// Builds both prefixes with the real check_question job, then claims a running slot and begins the meeting as the start route does.
export async function startTestMeeting(test: MeetingTestContext, meetingId: string): Promise<void> {
  await withMeeting(test.context.db, meetingId, (trx) =>
    trx
      .updateTable("meeting_members")
      .set({ ready_at: test.clock.now() })
      .where("meeting_id", "=", meetingId)
      .execute(),
  );
  await runMeetingJob(test, "check_question", { meetingId });
  const meeting = await withMeeting(test.context.db, meetingId, (trx) =>
    trx
      .selectFrom("meetings")
      .select("state")
      .where("id", "=", meetingId)
      .executeTakeFirstOrThrow(),
  );
  if (meeting.state === "queued")
    throw new ContractError(
      "test_meeting_queued",
      "The test database has 40 running meetings. End them in afterEach.",
      500,
    );
  if (meeting.state !== "running")
    throw new ContractError(
      "test_meeting_not_started",
      "The test meeting did not start. Check its question and both cards.",
      500,
    );
}

// One side's approved card items with their turn_index and turn id, in position order, for scripts that quote the card.
export async function readSideItems(
  db: Kysely<Database>,
  meetingId: string,
  side: "a" | "b",
): Promise<
  Array<{
    position: number;
    claim: string;
    quote: string;
    lang: string;
    gloss: string;
    turnIndex: number;
    turnId: string;
  }>
> {
  return withMeeting(db, meetingId, async (trx) => {
    const member = await trx
      .selectFrom("meeting_members")
      .select(["card_id", "public_only"])
      .where("meeting_id", "=", meetingId)
      .where("side", "=", side)
      .executeTakeFirstOrThrow();
    const rows = await trx
      .selectFrom("card_items as ci")
      .innerJoin("turns as t", "t.id", "ci.turn_id")
      .select([
        "ci.position",
        "ci.claim",
        "ci.quote",
        "ci.lang",
        "ci.gloss",
        "t.turn_index",
        "t.id as turn_id",
      ])
      .where("ci.card_id", "=", member.card_id)
      .where("ci.approved", "=", true)
      .$if(member.public_only, (query) => query.where("ci.is_public", "=", true))
      .orderBy("ci.position")
      .execute();
    return rows.map((row) => ({
      position: row.position,
      claim: row.claim,
      quote: row.quote,
      lang: row.lang,
      gloss: row.gloss,
      turnIndex: row.turn_index,
      turnId: row.turn_id,
    }));
  });
}

// The next job the drain should run: due on the fake clock, of an allowed name, earliest run_at first, first enqueued on a tie.
function nextDueJob(test: MeetingTestContext, names: readonly JobName[]): EnqueuedJob | undefined {
  const now = test.clock.now().getTime();
  let best: EnqueuedJob | undefined;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const job of test.pending) {
    if (!names.includes(job.name)) continue;
    const at = job.options?.runAt?.getTime() ?? now;
    if (at <= now && at < bestAt) {
      best = job;
      bestAt = at;
    }
  }
  return best;
}

// True for the three job names a meeting test can run by hand.
function isMeetingJobName(name: JobName): name is MeetingJobName {
  return (MEETING_JOB_NAMES as readonly JobName[]).includes(name);
}
