import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContractError } from "@meet-first/contracts";
import { makeDatabase, withMeeting, type Database } from "@meet-first/db";
import { requestHash, type LiveCaller, type LlmRequest } from "@meet-first/llm";
import sharp from "sharp";
import type { Kysely } from "kysely";
import { renderComicTask } from "../render-comic-job.js";
import type { EncodedPipeline } from "../image-calls.js";
import { makeTestJobContext } from "../../testing/index.js";
import { scriptedRecordedCall, structuredReplyLayout } from "../../meetings/testing/scripted-replies.js";

// The repository root, from this file's folder five levels down.
const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
// The folder of the recorded replies, relative to the repository root.
const FIXTURE_DIR = join(REPO_ROOT, "packages/evals/fixtures/model-replies");
// The fixed captions and image prompts of the golden comic: plain sentences, no name, no email, no run of digits.
const GOLDEN_PANELS = [
  { caption: "A and B sit down to talk about the work.", image_prompt: "A and B sit at a round wooden table in a sunny garden, both leaning in with calm faces." },
  { caption: "A and B agree on a plan that both can read.", image_prompt: "A and B hold one open notebook between them, both nodding, with a tall window behind them." },
  { caption: "A and B spot a place where they see things differently.", image_prompt: "A and B stand on opposite sides of a small wooden bridge, each pointing a different way." },
  { caption: "A and B talk through that difference, step by step.", image_prompt: "A and B sit on a bench with a lamp between them, one with a raised hand and one listening." },
  { caption: "A and B make a decision together at the table.", image_prompt: "A and B shake hands over a low table with a single cup of tea, both smiling." },
  { caption: "A and B settle who takes the first piece of work.", image_prompt: "A and B walk toward a red door together, one carrying a small box and the other a ladder." },
];
// The circle colour of each panel, one per position, so the six images differ.
const PANEL_COLOURS = ["#d1495b", "#2e86ab", "#f2a541", "#3a7d44", "#7b5ea7", "#1b998b"];
// The usage of a scripted call: all zeros, as every hand-written fixture has.
const NO_USAGE = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 };

// What the golden command needs: the worker's database URL, the meeting, and the folder to write into.
export type GoldenComicOptions = { workerUrl: string; meetingId: string; fixtureRoot?: string };

// A flat colour square with one coloured circle, as a 1024 by 1024 webp under 150 KB, for a panel position.
async function panelWebp(position: number): Promise<Uint8Array> {
  const colour = PANEL_COLOURS[position - 1] ?? PANEL_COLOURS[0] ?? "#d1495b";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="300" fill="${colour}"/></svg>`;
  const pipeline = sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#f4efe6" } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .webp({ quality: 80 }) as unknown as EncodedPipeline;
  return pipeline.toBuffer();
}

// The panel position a comic_image request names, read from its "Panel k of 6" text.
function positionOf(prompt: unknown): number {
  const match = /Panel (\d) of 6/.exec(String(prompt));
  if (match === null) throw new ContractError("golden_panel_unknown", "A comic image request does not name its panel. Check the comic-image template.", 500);
  return Number(match[1]);
}

// Writes the recorded reply of every call the job makes, and returns the reply the job reads.
async function scriptedReply(request: LlmRequest, folder: string, written: string[]): Promise<Record<string, unknown>> {
  const callSite = request.callSite;
  const response: Record<string, unknown> = callSite === "comic_image" ? { data: [{ b64_json: Buffer.from(await panelWebp(positionOf(request.body.prompt))).toString("base64") }] } : structuredReplyLayout({ panels: GOLDEN_PANELS });
  const call = scriptedRecordedCall(request, response);
  const callFolder = join(folder, callSite);
  await mkdir(callFolder, { recursive: true });
  const path = join(callFolder, `${requestHash(request.body)}.json`);
  await writeFile(path, `${JSON.stringify(call, null, 2)}\n`);
  written.push(path);
  return response;
}

// Clears the comic back to rendering with its panels gone, runs render_comic in-process with the scripted client, and returns the fixture paths written.
export async function writeComicFixtures(options: GoldenComicOptions): Promise<string[]> {
  const folder = options.fixtureRoot ?? FIXTURE_DIR;
  const db: Kysely<Database> = makeDatabase(options.workerUrl, 4);
  try {
    const comic = await withMeeting(db, options.meetingId, (trx) => trx.selectFrom("comics").select(["id", "state"]).where("meeting_id", "=", options.meetingId).executeTakeFirst());
    if (comic === undefined) throw new ContractError("golden_comic_missing", "This meeting has no comic row. Run the golden path to step 14 first, then run this command with that meeting id.", 400);
    await withMeeting(db, options.meetingId, async (trx) => {
      await trx.updateTable("comics").set({ state: "rendering", finished_at: null }).where("id", "=", comic.id).execute();
      await trx.deleteFrom("comic_panels").where("comic_id", "=", comic.id).execute();
    });
    const written: string[] = [];
    const live: LiveCaller = async (request) => {
      const response = await scriptedReply(request, folder, written);
      return { response, usage: NO_USAGE, requestId: null, httpStatus: 200 };
    };
    const { context } = makeTestJobContext({ db, live });
    await renderComicTask({ comicId: comic.id, meetingId: options.meetingId }, context);
    const after = await withMeeting(db, options.meetingId, (trx) => trx.selectFrom("comics").select("state").where("id", "=", comic.id).executeTakeFirstOrThrow());
    if (after.state !== "ready") throw new ContractError("golden_comic_not_ready", "The golden comic did not reach ready from the scripted replies. Check the comic prompt and its scrubber.", 500);
    return written;
  } finally {
    await db.destroy();
  }
}

// The command entry: "meeting <id>" writes the comic fixtures, with an optional --fixture-root folder. Each path is printed on its own line.
async function main(argv: readonly string[]): Promise<string[]> {
  const meetingId = argv[1];
  if (argv[0] !== "meeting" || meetingId === undefined) throw new ContractError("golden_command_unknown", "Use the word meeting and a meeting id, with an optional --fixture-root folder.", 400);
  const rootAt = argv.indexOf("--fixture-root");
  const fixtureRoot = rootAt === -1 ? undefined : argv[rootAt + 1];
  return writeComicFixtures({ workerUrl: process.env.DATABASE_URL_WORKER ?? "", meetingId, ...(fixtureRoot === undefined ? {} : { fixtureRoot }) });
}

// Runs the command when this file is the process entry; importing it for tests starts nothing.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (paths) => {
      for (const path of paths) process.stdout.write(path + "\n");
    },
    (error: unknown) => {
      const line = error instanceof ContractError ? error.code + ": " + error.message : "golden_failed: " + String(error);
      process.stderr.write(line + "\n");
      process.exitCode = 1;
    },
  );
}
