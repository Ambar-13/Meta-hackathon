// Writes both humans' briefs after a meeting ends, checks each line's quote with a second model call, then tells both browsers with one brief.ready event.
import type { Kysely } from "kysely";
import { type QuestionKind, BriefOutput, BriefSupportJudgeOutput, type CommittedEvent, ContractError, EVENT_VERSION, rowToEvent, toStrictJsonSchema, type TurnCommitted } from "@meet-first/contracts";
import { appendMeetingEvent, numberFromPostgres, withMeeting, type Database, type DatabaseTransaction } from "@meet-first/db";
import { CapReached, CHAT_MODEL, LimiterBusy } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import type { JobContext, JobTask } from "../job-context.js";
import { buildBriefPromptInput, verifyBriefQuotes, type ApprovedItem, type BriefSide, type BriefSections, type SourceTurn, type TranscriptTurn } from "./brief-lines.js";
import { applyJudgeOutput, buildJudgeInput, computeSupportRate } from "./support-judge.js";

// The brief call. Effort medium. The client applies these from CALL_SITE_CONFIG; the values match it.
export const BRIEF_CALL = { effort: "medium", maxTokens: 4000, timeoutMs: 120_000, retries: 1 } as const;
// The support judge. Minimal effort, temperature 0, 30 s, one retry. The client applies these from CALL_SITE_CONFIG.
export const SUPPORT_JUDGE_CALL = { effort: "minimal", temperature: 0, maxTokens: 2000, timeoutMs: 30_000, retries: 1 } as const;

// The two sides of a meeting, in the order the job writes them.
const SIDES = ["a", "b"] as const;
// The one side letter the job works with.
type Side = (typeof SIDES)[number];
// The meeting as the brief job reads it once: who the members are, the notes, the transcript, the items and what is written already.
export type BriefSnapshot = {
  meetingId: string; questionText: string; questionKind: QuestionKind; sides: Record<Side, BriefSide>; sourceTurns: SourceTurn[]; transcript: TranscriptTurn[];
  items: ApprovedItem[]; writtenSides: Side[]; hasReadyEvent: boolean;
};
// What the snapshot read gives: the meeting to work on, or the reason there is nothing to write.
export type SnapshotRead = { kind: "ready"; snapshot: BriefSnapshot } | { kind: "skipped"; reason: "meeting_gone" | "meeting_not_ended" };
// One finished brief for one side, ready to store: its sections, the check's outcome and its raw record.
type SideBrief = { side: Side; personId: string; sections: BriefSections; reliable: boolean; checkedAt: Date | null; rate: number | null; raw: Record<string, unknown>; promptVersion: string };
// The outcome of the support check for one brief.
type JudgeOutcome = { sections: BriefSections; reliable: boolean; rate: number | null; raw: Record<string, unknown> };
// One member row with the person's display name.
type MemberRow = { side: Side; person_id: string; card_id: string; display_name: string; public_only: boolean };

// Writes the briefs of an ended meeting that are not written yet, then the brief.ready event once both exist.
export const writeBriefsTask: JobTask<"write_briefs"> = async (payload, context) => {
  const read = await readBriefSnapshot(context.db, payload.meetingId);
  if (read.kind === "skipped") {
    if (read.reason === "meeting_not_ended") context.log.info({ meetingId: payload.meetingId }, "write_briefs_meeting_not_ended");
    return;
  }
  const { snapshot } = read;
  if (snapshot.writtenSides.length === SIDES.length && snapshot.hasReadyEvent) return;
  for (const side of SIDES) {
    if (snapshot.writtenSides.includes(side)) continue;
    const brief = await writeSideBrief(context, snapshot, side);
    await insertSideBrief(context.db, snapshot.meetingId, brief);
  }
  await writeReadyEventIfMissing(context.db, snapshot.meetingId, context.now());
};

// Reads the meeting, its members, notes, transcript, approved items and written briefs in one meeting context.
export async function readBriefSnapshot(db: Kysely<Database>, meetingId: string): Promise<SnapshotRead> {
  return withMeeting(db, meetingId, async (trx) => {
    const meeting = await trx.selectFrom("meetings").select(["id", "state", "question_text", "question_kind"]).where("id", "=", meetingId).executeTakeFirst();
    if (meeting === undefined) return { kind: "skipped", reason: "meeting_gone" };
    if (meeting.state !== "ended") return { kind: "skipped", reason: "meeting_not_ended" };
    const members = await readMembers(trx, meetingId);
    const sides = Object.fromEntries(members.map((member) => [member.side, { side: member.side, personId: member.person_id, displayName: member.display_name, cardId: member.card_id }])) as Record<Side, BriefSide>;
    const sourceTurns = await readSourceTurns(trx, members);
    const events = (await trx.selectFrom("meeting_events").select(["meeting_id", "seq", "type", "v", "payload", "created_at"]).where("meeting_id", "=", meetingId).orderBy("seq", "asc").execute()).map(rowToEvent);
    const items = await readApprovedItems(trx, members);
    const briefs = await trx.selectFrom("briefs").select("person_id").where("meeting_id", "=", meetingId).execute();
    const writtenSides = members.filter((member) => briefs.some((brief) => brief.person_id === member.person_id)).map((member) => member.side);
    const snapshot: BriefSnapshot = {
      meetingId, questionText: meeting.question_text, questionKind: meeting.question_kind, sides, sourceTurns, transcript: transcriptOf(events), items, writtenSides,
      hasReadyEvent: events.some((event) => event.type === "brief.ready"),
    };
    return { kind: "ready", snapshot };
  });
}

// The two members of the meeting with their names, or a refusal when the meeting does not have two.
async function readMembers(trx: DatabaseTransaction, meetingId: string): Promise<MemberRow[]> {
  const members = await trx.selectFrom("meeting_members as mm").innerJoin("people as p", "p.id", "mm.person_id").select(["mm.side", "mm.person_id", "mm.card_id", "p.display_name", "mm.public_only"]).where("mm.meeting_id", "=", meetingId).orderBy("mm.side", "asc").execute();
  if (members.length !== SIDES.length) throw new ContractError("write_briefs_members_missing", "The meeting does not have two members. Nothing to write; check the pair.", 500);
  return members;
}

// The notes of both cards' sources, each turn tagged with the side whose card it belongs to.
async function readSourceTurns(trx: DatabaseTransaction, members: MemberRow[]): Promise<SourceTurn[]> {
  const cards = await trx.selectFrom("cards").select(["id", "source_id"]).where("id", "in", members.map((member) => member.card_id)).execute();
  const sideBySource = new Map(members.map((member) => [cards.find((card) => card.id === member.card_id)?.source_id ?? "", member.side]));
  const turns = await trx.selectFrom("turns").select(["id", "source_id", "person_id", "turn_index", "text", "norm_text"]).where("source_id", "in", [...sideBySource.keys()]).orderBy("turn_index", "asc").execute();
  return turns.flatMap((turn) => {
    const side = sideBySource.get(turn.source_id);
    return side === undefined ? [] : [{ id: turn.id, side, personId: turn.person_id, turnIndex: turn.turn_index, text: turn.text, normText: turn.norm_text }];
  });
}

// The approved items of both cards, with the side each belongs to. A listed persona met through the directory brings only its public items.
async function readApprovedItems(trx: DatabaseTransaction, members: MemberRow[]): Promise<ApprovedItem[]> {
  const rows = await trx.selectFrom("card_items").select(["card_id", "position", "kind", "claim", "lang", "quote", "turn_id", "verified", "is_public"]).where("card_id", "in", members.map((member) => member.card_id)).where("approved", "=", true).orderBy("position", "asc").execute();
  return rows.flatMap((row) => {
    const member = members.find((candidate) => candidate.card_id === row.card_id);
    if (member === undefined || (member.public_only && !row.is_public)) return [];
    return [{ side: member.side, position: row.position, kind: row.kind, claim: row.claim, lang: row.lang, quote: row.quote, turnId: row.turn_id, verified: row.verified }];
  });
}

// The committed turns of the meeting in step order, with their claims.
function transcriptOf(events: CommittedEvent[]): TranscriptTurn[] {
  return events.flatMap((event) => {
    if (event.type !== "turn.committed") return [];
    const turn: TurnCommitted = event;
    return [{ stepSeq: turn.stepSeq, side: turn.side, phase: turn.phase, text: turn.text, claims: turn.claims }];
  });
}

// Writes one side's brief: the brief call, the quote check, then the support check.
async function writeSideBrief(context: JobContext, snapshot: BriefSnapshot, side: Side): Promise<SideBrief> {
  const recipient = snapshot.sides[side];
  const other = snapshot.sides[side === "a" ? "b" : "a"];
  const prompt = readPrompt("brief");
  const input = buildBriefPromptInput({ recipient, other, questionText: snapshot.questionText, questionKind: snapshot.questionKind, sourceTurns: snapshot.sourceTurns, transcript: snapshot.transcript, items: snapshot.items, promptText: prompt.text, untrustedRulesText: readPrompt("untrusted-data-rules").text });
  const reply = await context.llm.complete({ callSite: "brief", promptVersion: prompt.version, messages: input.messages, schema: toStrictJsonSchema(BriefOutput, "brief"), ledger: { personId: null, meetingId: snapshot.meetingId } });
  const output = BriefOutput.safeParse(reply.parsed);
  if (!output.success) throw new ContractError("write_briefs_reply_invalid", "The brief reply did not match the brief schema. The job runs once more.", 502);
  const sections = verifyBriefQuotes({ output: output.data, sourceTurns: snapshot.sourceTurns, personBySide: { a: snapshot.sides.a.personId, b: snapshot.sides.b.personId }, questionText: snapshot.questionText });
  const judged = await checkSupport(context, { meetingId: snapshot.meetingId, side, sections });
  const checkedAt = judged.reliable ? context.now() : null;
  return { side, personId: recipient.personId, sections: judged.sections, reliable: judged.reliable, checkedAt, rate: judged.rate, raw: judged.raw, promptVersion: prompt.version };
}

// Runs the support judge for one brief, with its one retry. A failed judge after its retry leaves every line unchecked (fail closed); a full window or a cap is passed up.
async function checkSupport(context: JobContext, check: { meetingId: string; side: Side; sections: BriefSections }): Promise<JudgeOutcome> {
  const { meetingId, side, sections } = check;
  const prompt = readPrompt("brief-support-judge");
  const input = buildJudgeInput({ side, points: sections, promptText: prompt.text });
  let lastError: ContractError | undefined;
  for (let attempt = 0; attempt <= SUPPORT_JUDGE_CALL.retries; attempt += 1) {
    try {
      const reply = await context.llm.complete({ callSite: "brief_support_judge", promptVersion: prompt.version, messages: input.messages, schema: toStrictJsonSchema(BriefSupportJudgeOutput, "brief-support-judge"), ledger: { personId: null, meetingId } });
      const verdict = BriefSupportJudgeOutput.safeParse(reply.parsed);
      if (!verdict.success) return failedCheck(sections, "brief_support_judge_invalid");
      const judged = applyJudgeOutput(sections, verdict.data);
      return { sections: judged, reliable: true, rate: computeSupportRate(judged), raw: { order: input.order, flipped: input.flipped, output: verdict.data } };
    } catch (error) {
      if (error instanceof LimiterBusy || error instanceof CapReached) throw error;
      if (!(error instanceof ContractError)) throw error;
      lastError = error;
    }
  }
  const code = lastError?.code ?? "brief_support_judge_error";
  context.log.warn({ meetingId, side, code }, "write_briefs_judge_failed: every line of this brief is marked weak receipt");
  return failedCheck(sections, code);
}

// The outcome of a support check that did not run: every line stays unchecked, the rate is null, and the code is kept.
function failedCheck(sections: BriefSections, code: string): JudgeOutcome {
  const unchecked = { agree: sections.agree.map((point) => ({ ...point, supported: null })), clash: sections.clash.map((point) => ({ ...point, supported: null })), decideFirst: sections.decideFirst.map((point) => ({ ...point, supported: null })) };
  return { sections: unchecked, reliable: false, rate: null, raw: { error: code } };
}

// Stores one side's brief. A second attempt that races the first loses quietly on the unique key (one brief per recipient).
async function insertSideBrief(db: Kysely<Database>, meetingId: string, brief: SideBrief): Promise<void> {
  await withMeeting(db, meetingId, (trx) =>
    trx.insertInto("briefs").values({
      meeting_id: meetingId, person_id: brief.personId,
      agree: JSON.stringify(brief.sections.agree), clash: JSON.stringify(brief.sections.clash), decide_first: JSON.stringify(brief.sections.decideFirst),
      model: CHAT_MODEL, prompt_version: brief.promptVersion,
      support_checked_at: brief.checkedAt, support_rate: brief.rate, support_reliable: brief.reliable, support_raw: JSON.stringify(brief.raw),
    }).onConflict((conflict) => conflict.columns(["meeting_id", "person_id"]).doNothing()).execute(),
  );
}

// Writes brief.ready once, after both briefs exist. The meeting row is locked first, so two writers take turns.
async function writeReadyEventIfMissing(db: Kysely<Database>, meetingId: string, now: Date): Promise<void> {
  await withMeeting(db, meetingId, async (trx) => {
    await trx.selectFrom("meetings").select("id").where("id", "=", meetingId).forUpdate().executeTakeFirst();
    const ready = await trx.selectFrom("meeting_events").select("seq").where("meeting_id", "=", meetingId).where("type", "=", "brief.ready").executeTakeFirst();
    if (ready !== undefined) return;
    const rows = await trx.selectFrom("briefs as b").innerJoin("meeting_members as mm", (join) => join.onRef("mm.person_id", "=", "b.person_id").on("mm.meeting_id", "=", meetingId)).select(["mm.side", "b.support_rate"]).where("b.meeting_id", "=", meetingId).execute();
    if (rows.length !== SIDES.length) throw new ContractError("write_briefs_incomplete", "Both briefs must exist before brief.ready is written. Run the job again.", 500);
    const rateOf = (side: Side): number | null => {
      const row = rows.find((candidate) => candidate.side === side);
      return row === undefined || row.support_rate === null ? null : numberFromPostgres(row.support_rate);
    };
    await appendMeetingEvent(trx, meetingId, { v: EVENT_VERSION, meetingId, at: now.toISOString(), type: "brief.ready", supportRate: { a: rateOf("a"), b: rateOf("b") } });
  });
}
