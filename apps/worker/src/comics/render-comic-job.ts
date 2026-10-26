import { Avatar, BriefPoint, ComicPanelsOutput, ContractError, type JobPayload, toStrictJsonSchema } from "@meet-first/contracts";
import { withMeeting, type Database } from "@meet-first/db";
import { LimiterBusy, reenqueueAfterLimiter, type CompleteResult } from "@meet-first/llm";
import { readPrompt } from "@meet-first/prompts";
import { scrub } from "@meet-first/scrub";
import type { Kysely } from "kysely";
import type { JobContext, JobTask } from "../job-context.js";
import { appendMeetingEvent } from "../meetings/index.js";
import { raceWithDeadline, renderPanels, type PanelRender, type Raced } from "./image-calls.js";
import { buildImagePrompts, buildPanelsPromptInput, pickHeadlines } from "./panel-prompts.js";

// D64, R11.2: the whole comic has 60 s from job start; the brief is already on screen, so a slow comic is skipped, not waited for.
export const COMIC_DEADLINE_MS = 60_000;
// D64: exactly six panels.
export const PANEL_COUNT = 6;

// Why a comic was not made, as comic.skipped gives it. render_failed ends the comic as failed; the others end it as skipped.
export type SkipReason = "deadline" | "prompt_blocked" | "render_failed" | "no_supported_lines" | "brief_not_ready" | "meeting_not_ended";
// The result of the scrub step: every final prompt passes, or the reason the comic is refused.
export type PromptCheck = { kind: "ok"; prompts: string[] } | { kind: "blocked"; reason: "prompt_blocked"; categories: string[] };

// What the job reads from the database before it calls the model.
type ComicInput = { avatarA: Avatar; avatarB: Avatar; questionText: string; displayNames: { a: string; b: string }; briefs: { agree: BriefPoint[]; clash: BriefPoint[]; decideFirst: BriefPoint[] }[] };
// The result of reading the comic's rows before any model call.
type ReadResult = { kind: "stop" } | { kind: "skip"; reason: SkipReason } | { kind: "ready"; input: ComicInput };
// The panel plan from the model: one caption and one image prompt for each of the six panels.
type Plan = { captions: string[]; imagePrompts: string[] };
// What the model's plan reply came to: a plan, or the reason there is none.
type PlanResult = { kind: "ok"; value: Plan } | { kind: "deadline" } | { kind: "limiter_busy" } | { kind: "failed" };
// What the drawing of one comic came to: store six panels, retry later, or end it with a reason.
type Drawing = { kind: "store"; stored: { captions: string[]; prompts: string[]; panels: PanelRender[] } } | { kind: "retry" } | { kind: "skip"; reason: SkipReason };

// Runs the render_comic job: six captions and prompts, scrubbed, six images, all or nothing (D64, R11.1, R11.2).
export const renderComicTask: JobTask<"render_comic"> = async (payload, context) => {
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
  }, COMIC_DEADLINE_MS);
  try {
    await renderComic(payload, context, abort.signal);
  } catch (error) {
    context.log.error({ comicId: payload.comicId, code: errorCode(error) }, "render_comic: failed");
    await finishNotReady(context, payload, "render_failed");
  } finally {
    clearTimeout(timer);
  }
};

// The code a failed step carries into the log, or a plain word when the error is not a ContractError.
function errorCode(error: unknown): string {
  return error instanceof ContractError ? error.code : "render_error";
}

// Reads the comic, then draws it and either stores it, retries it later, or ends it with its reason.
async function renderComic(payload: JobPayload<"render_comic">, context: JobContext, signal: AbortSignal): Promise<void> {
  const read = await readComicInput(context.db, payload);
  if (read.kind === "stop") return;
  if (read.kind === "skip") return finishNotReady(context, payload, read.reason);
  const drawing = await draw(context, payload, { input: read.input, signal });
  if (drawing.kind === "retry") return reenqueueAfterLimiter(context, "render_comic", payload);
  if (drawing.kind === "skip") return finishNotReady(context, payload, drawing.reason);
  return storeComic(context, payload, drawing.stored);
}

// The steps between the database read and the stored panels: headlines, the plan, the scrub, the six images.
async function draw(context: JobContext, payload: JobPayload<"render_comic">, job: { input: ComicInput; signal: AbortSignal }): Promise<Drawing> {
  const { input, signal } = job;
  const headlines = pickHeadlines(input.briefs);
  if (headlines.length === 0) return { kind: "skip", reason: "no_supported_lines" };
  const plan = await requestPlan(context, payload, { input, headlines, signal });
  if (plan.kind !== "ok") return drawingForPlanFailure(plan);
  const prompts = buildImagePrompts({
    panels: plan.value.captions.map((caption, index) => ({ caption, image_prompt: plan.value.imagePrompts[index] ?? "" })),
    avatarA: input.avatarA,
    avatarB: input.avatarB,
    displayNames: input.displayNames,
    templateText: readPrompt("comic-image").text,
  });
  const check = checkPromptsWithScrubber(prompts);
  if (check.kind === "blocked") {
    context.log.warn({ comicId: payload.comicId, categories: check.categories }, "render_comic: a prompt was blocked by the scrubber");
    return { kind: "skip", reason: check.reason };
  }
  const images = await renderPanels(context.llm, check.prompts, { signal, meetingId: payload.meetingId });
  if (images.kind === "ready") return { kind: "store", stored: { captions: plan.value.captions, prompts: check.prompts, panels: images.panels } };
  if (images.kind === "limiter_busy") return { kind: "retry" };
  if (images.kind === "deadline") return { kind: "skip", reason: "deadline" };
  return { kind: "skip", reason: "render_failed" };
}

// The drawing a failed plan call leads to: a full window retries, a missed deadline is skipped, anything else failed the comic.
function drawingForPlanFailure(plan: Exclude<PlanResult, { kind: "ok" }>): Drawing {
  if (plan.kind === "limiter_busy") return { kind: "retry" };
  if (plan.kind === "deadline") return { kind: "skip", reason: "deadline" };
  return { kind: "skip", reason: "render_failed" };
}

// Reads the comic row, its meeting, the two names, both briefs and the brief.ready event in one meeting transaction.
async function readComicInput(db: Kysely<Database>, payload: JobPayload<"render_comic">): Promise<ReadResult> {
  return withMeeting(db, payload.meetingId, async (trx): Promise<ReadResult> => {
    const comic = await trx.selectFrom("comics").select(["id", "state", "avatar_a", "avatar_b"]).where("id", "=", payload.comicId).executeTakeFirst();
    if (comic === undefined || comic.state !== "rendering") return { kind: "stop" };
    const meeting = await trx.selectFrom("meetings").select(["state", "question_text"]).where("id", "=", payload.meetingId).executeTakeFirst();
    if (meeting === undefined) return { kind: "stop" };
    if (meeting.state !== "ended") return { kind: "skip", reason: "meeting_not_ended" };
    const brief = await trx.selectFrom("meeting_events").select("seq").where("meeting_id", "=", payload.meetingId).where("type", "=", "brief.ready").executeTakeFirst();
    if (brief === undefined) return { kind: "skip", reason: "brief_not_ready" };
    const members = await trx.selectFrom("meeting_members as mm").innerJoin("people as p", "p.id", "mm.person_id").select(["mm.side", "mm.person_id", "p.display_name"]).where("mm.meeting_id", "=", payload.meetingId).execute();
    const nameOf = (side: "a" | "b"): string => members.find((member) => member.side === side)?.display_name ?? "";
    const rows = await trx.selectFrom("briefs").select(["person_id", "agree", "clash", "decide_first"]).where("meeting_id", "=", payload.meetingId).execute();
    // Side a's brief comes first, so the headlines and the model request keep one order on every run (D74).
    const sideOf = (personId: string): number => (members.find((member) => member.person_id === personId)?.side === "a" ? 0 : 1);
    const briefs = [...rows]
      .sort((first, second) => sideOf(first.person_id) - sideOf(second.person_id))
      .map((row) => ({
        agree: BriefPoint.array().parse(row.agree),
        clash: BriefPoint.array().parse(row.clash),
        decideFirst: BriefPoint.array().parse(row.decide_first),
      }));
    return {
      kind: "ready",
      input: { avatarA: Avatar.parse(comic.avatar_a), avatarB: Avatar.parse(comic.avatar_b), questionText: meeting.question_text, displayNames: { a: nameOf("a"), b: nameOf("b") }, briefs },
    };
  });
}

// Asks the model for six captions and image prompts, checked against its schema. A full token window or a missed deadline is reported, never retried here.
async function requestPlan(context: JobContext, payload: JobPayload<"render_comic">, job: { input: ComicInput; headlines: string[]; signal: AbortSignal }): Promise<PlanResult> {
  const prompt = readPrompt("comic-panels");
  const messages = buildPanelsPromptInput({ questionText: job.input.questionText, avatarA: job.input.avatarA, avatarB: job.input.avatarB, headlines: job.headlines, displayNames: job.input.displayNames, promptText: prompt.text });
  const work = context.llm.complete({ callSite: "comic_panels", promptVersion: prompt.version, messages, schema: toStrictJsonSchema(ComicPanelsOutput, "comic-panels"), ledger: { personId: null, meetingId: payload.meetingId } });
  let raced: Raced<CompleteResult>;
  try {
    raced = await raceWithDeadline(work, job.signal);
  } catch (error) {
    if (error instanceof LimiterBusy) return { kind: "limiter_busy" };
    context.log.error({ comicId: payload.comicId, code: errorCode(error) }, "render_comic: the panels call failed");
    return { kind: "failed" };
  }
  if (raced.kind === "deadline") return { kind: "deadline" };
  const parsed = ComicPanelsOutput.safeParse(raced.value.parsed);
  if (!parsed.success) return { kind: "failed" };
  return {
    kind: "ok",
    value: { captions: parsed.data.panels.map((panel) => panel.caption), imagePrompts: parsed.data.panels.map((panel) => panel.image_prompt) },
  };
}

// Scrubs every final image prompt; one hit refuses the whole comic, and the scrubbed text is the only text ever sent (D65, R7.5).
export function checkPromptsWithScrubber(prompts: string[]): PromptCheck {
  const scrubbed = prompts.map((prompt) => scrub(prompt, { allowlist: [] }));
  const categories = scrubbed.flatMap((result) => result.redactions.map((redaction) => redaction.category));
  if (categories.length > 0) return { kind: "blocked", reason: "prompt_blocked", categories };
  return { kind: "ok", prompts: scrubbed.map((result) => result.text) };
}

// Writes six panels and the ready state in one meeting transaction, then the comic.ready event (R11.1).
async function storeComic(context: JobContext, payload: JobPayload<"render_comic">, stored: { captions: string[]; prompts: string[]; panels: PanelRender[] }): Promise<void> {
  if (stored.panels.length !== PANEL_COUNT) throw new ContractError("comic_panel_count", "A ready comic must have six panels. Check the image step.", 500);
  const now = context.now();
  await withMeeting(context.db, payload.meetingId, async (trx) => {
    await trx.insertInto("comic_panels").values(
      stored.panels.map((panel) => ({
        comic_id: payload.comicId,
        meeting_id: payload.meetingId,
        position: panel.position,
        caption: stored.captions[panel.position - 1] ?? "",
        image_prompt: stored.prompts[panel.position - 1] ?? "",
        image: Buffer.from(panel.bytes),
      })),
    ).execute();
    const updated = await trx.updateTable("comics").set({ state: "ready", finished_at: now }).where("id", "=", payload.comicId).where("state", "=", "rendering").returning("id").executeTakeFirst();
    if (updated === undefined) throw new ContractError("comic_already_finished", "This comic already has a result, so the panels were not stored again.", 409);
    await appendMeetingEvent(trx, { meetingId: payload.meetingId, type: "comic.ready", fields: { comicId: payload.comicId }, at: now });
  });
}

// Ends a comic that will not be drawn, with its reason in comic.skipped; render_failed ends it as failed, the rest as skipped (D64).
async function finishNotReady(context: JobContext, payload: JobPayload<"render_comic">, reason: SkipReason): Promise<void> {
  const state = reason === "render_failed" ? "failed" : "skipped";
  const now = context.now();
  await withMeeting(context.db, payload.meetingId, async (trx) => {
    const updated = await trx.updateTable("comics").set({ state, finished_at: now }).where("id", "=", payload.comicId).where("state", "=", "rendering").returning("id").executeTakeFirst();
    if (updated === undefined) return;
    await appendMeetingEvent(trx, { meetingId: payload.meetingId, type: "comic.skipped", fields: { comicId: payload.comicId, reason }, at: now });
  });
}
