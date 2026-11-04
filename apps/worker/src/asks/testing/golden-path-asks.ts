// The golden path's ask writer. Run it once the golden path has stopped before step 20
// (friend-ask): it reads the run's people from the run's report, sends the same friend ask and help
// search the golden path sends, answers each model call by rule, writes the reply as a recorded
// fixture, then lets the replay client answer from it. A request holds no id or time, so the golden
// path's own asks later send the same requests and read these replies.
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pino } from "pino";
import { z } from "zod";
import { ContractError, Uuid } from "@meet-first/contracts";
import { makeDatabase, POOL_SIZE, queryWords, withPerson } from "@meet-first/db";
import {
  makeLlmClient,
  requestHash,
  type ChatMessage,
  type CompleteArgs,
  type LlmClient,
} from "@meet-first/llm";
import { testWorkerEnv } from "@meet-first/llm/testing";
import type { JobContext } from "../../job-context.js";
import {
  chatBodyFor,
  scriptedRecordedCall,
  structuredReplyLayout,
} from "../../meetings/testing/index.js";
import { runAsk } from "../run-ask-job.js";

// The friend ask of golden path step 20, as scripts/golden-path/fixtures.ts sends it
// (REACT_ASK_TEXT).
export const GOLDEN_REACT_TEXT =
  "How would you probably react if the team moved the demo day to a Saturday?";
// The help search of golden path step 21, as scripts/golden-path/fixtures.ts sends it
// (HELP_ASK_TEXT).
export const GOLDEN_HELP_TEXT =
  "I keep getting stuck on one hard problem and go round in circles. Who could help me think it through?";
// The friend's display name, as the golden path's step 1 creates it; the API copies it onto the
// friend ask.
const FRIEND_NAME = "B";
// The folder of the recorded replies, five levels above this file's folder.
const FIXTURE_DIR = fileURLToPath(
  new URL("../../../../../packages/evals/fixtures/model-replies", import.meta.url),
);
// The ids the writer reads from the golden path's report: the two people and their invite pair.
const ReportIds = z.object({ ids: z.object({ personA: Uuid, personB: Uuid, pairId: Uuid }) });

// The search words for the friend ask, by rule: the words of its subject.
const GOLDEN_SEARCH_WORDS = { words: ["demo day", "Saturday", "weekend"] };
// The question check's replies: a friend ask about a plan, and a help search about a problem;
// neither is about dating.
const REACT_CHECK = {
  allowed: true,
  reason: "An ask about how a friend would probably react to a change of plan.",
  kind: "situation",
  romantic: false,
};
const HELP_CHECK = {
  allowed: true,
  reason: "An ask about who could probably help with a problem.",
  kind: "help",
  romantic: false,
};

// One line of a persona request's card: the turn label, the claim and the quote.
type CardLine = { turnLabel: string; claim: string; quote: string };

// The text of a request's user message, or "" when it has none.
function userTextOf(messages: readonly ChatMessage[]): string {
  const user = messages.find(
    (message): message is Extract<ChatMessage, { role: "user" }> => message.role === "user",
  );
  return user === undefined ? "" : user.content;
}

// The card lines of a persona request, in card order, read from its your_card block ("[t:N] kind |
// claim | \"quote\"").
function cardLinesOf(user: string): CardLine[] {
  const block = /<your_card>\n([\s\S]*?)\n<\/your_card>/.exec(user)?.[1] ?? "";
  return [...block.matchAll(/^\[t:(\d+)\] [^|]+ \| (.+) \| "(.*)"$/gm)].map((match) => ({
    turnLabel: match[1] ?? "",
    claim: match[2] ?? "",
    quote: match[3] ?? "",
  }));
}

// The card line sharing the most words with the ask, the first in card order on a tie.
function closestLine(lines: readonly CardLine[], askText: string): CardLine | undefined {
  const askWords = new Set(queryWords(askText));
  const shared = (line: CardLine): number =>
    new Set(queryWords(line.claim + " " + line.quote).filter((word) => askWords.has(word))).size;
  return lines.reduce<CardLine | undefined>(
    (best, line) => (best === undefined || shared(line) > shared(best) ? line : best),
    undefined,
  );
}

// The persona reply by rule: a help answer rests on the card line closest to the ask, a friend
// answer on the first card line. Its one claim quotes that line's quote in the turn the line names,
// so the quote check finds it.
function personaReply(user: string): Record<string, unknown> {
  const mode = /^<ask kind="(help|react)">/.exec(user)?.[1];
  const askText = /^<ask kind="[a-z]+">(.*)<\/ask>$/m.exec(user)?.[1] ?? "";
  const lines = cardLinesOf(user);
  const line = mode === "help" ? closestLine(lines, askText) : lines[0];
  if (line === undefined)
    throw new ContractError(
      "golden_card_empty",
      "The persona request shows no card line to quote. Check the sharing step and the card build.",
      500,
    );
  const answer =
    mode === "help"
      ? `My human could probably help with this, in their own words: "${line.quote}".`
      : `My human would probably take this calmly and plan around it, in their own words: "${line.quote}".`;
  return {
    answer,
    has_sign: true,
    claims: [
      {
        text: line.claim,
        quote: line.quote,
        turn_id: line.turnLabel,
        lang: "en",
        gloss: line.claim,
      },
    ],
  };
}

// The support-check reply by rule: every item of the request is supported, one line per index from
// 0.
function judgeReply(user: string): Record<string, unknown> {
  const count = user.split('<item index="').length - 1;
  return {
    lines: Array.from(Array(count).keys(), (index) => ({
      index,
      supported: true,
      reason: "The quote carries the statement.",
    })),
  };
}

// The reply one call gets by rule, by call site.
function replyFor(args: CompleteArgs): Record<string, unknown> {
  const user = userTextOf(args.messages);
  if (args.callSite === "question_check")
    return user.startsWith('<ask_question for="react"') ? REACT_CHECK : HELP_CHECK;
  if (args.callSite === "persona_answer") return personaReply(user);
  if (args.callSite === "ask_support_judge") return judgeReply(user);
  if (args.callSite === "search_words") return GOLDEN_SEARCH_WORDS;
  throw new ContractError(
    "golden_call_unexpected",
    `The ask writer answers question_check, search_words, persona_answer and ask_support_judge calls only, not ${args.callSite}.`,
    500,
  );
}

// A client that writes each request's reply as a fixture, then lets the replay client answer from
// that fixture.
function recordingClient(options: {
  replay: LlmClient;
  fixtureRoot: string;
  written: string[];
}): LlmClient {
  return {
    complete: async (args) => {
      const body = chatBodyFor(args, false);
      const folder = join(options.fixtureRoot, args.callSite);
      const path = join(folder, `${requestHash(body)}.json`);
      const recorded = scriptedRecordedCall(
        { callSite: args.callSite, promptVersion: args.promptVersion, body },
        structuredReplyLayout(replyFor(args)),
      );
      await mkdir(folder, { recursive: true });
      await writeFile(path, `${JSON.stringify(recorded, null, 2)}\n`);
      options.written.push(path);
      return options.replay.complete(args);
    },
    stream: options.replay.stream,
    image: options.replay.image,
  };
}

// Sends one ask as A, as POST /api/asks writes it, runs run_ask on it, and fails unless the ask
// ends done.
async function sendAndRun(
  context: JobContext,
  ask: { personId: string; mode: "help" | "react"; text: string; pairId?: string },
): Promise<void> {
  const values =
    ask.mode === "react"
      ? {
          person_id: ask.personId,
          mode: ask.mode,
          text: ask.text,
          pair_id: ask.pairId ?? null,
          about_name: FRIEND_NAME,
        }
      : { person_id: ask.personId, mode: ask.mode, text: ask.text };
  const row = await withPerson(context.db, ask.personId, (trx) =>
    trx.insertInto("persona_asks").values(values).returning("id").executeTakeFirstOrThrow(),
  );
  await runAsk({ askId: row.id, personId: ask.personId }, context);
  const done = await withPerson(context.db, ask.personId, (trx) =>
    trx
      .selectFrom("persona_asks")
      .select("state")
      .where("id", "=", row.id)
      .executeTakeFirstOrThrow(),
  );
  if (done.state !== "done")
    throw new ContractError(
      "golden_ask_not_done",
      `The ${ask.mode} ask ended ${done.state}, not done. Check the people the golden path made.`,
      500,
    );
}

// Writes the recorded replies of the golden path's friend ask and help search for the people in the
// report; returns the paths written.
export async function writeAskFixtures(options: {
  workerUrl: string;
  reportPath: string;
  fixtureRoot: string;
}): Promise<string[]> {
  const { ids } = ReportIds.parse(JSON.parse(readFileSync(options.reportPath, "utf8")));
  const db = makeDatabase(options.workerUrl, POOL_SIZE.test);
  try {
    const env = testWorkerEnv("replay", { DATABASE_URL_WORKER: options.workerUrl });
    const now = (): Date => new Date();
    const replay = makeLlmClient({
      db,
      env,
      now,
      sleep: () => Promise.resolve(),
      random: () => 0.5,
      fixtureRoot: options.fixtureRoot,
    });
    const written: string[] = [];
    const context: JobContext = {
      db,
      env,
      now,
      enqueue: () => Promise.resolve(),
      llm: recordingClient({ replay, fixtureRoot: options.fixtureRoot, written }),
      log: pino({ level: "silent" }),
    };
    await sendAndRun(context, {
      personId: ids.personA,
      mode: "react",
      text: GOLDEN_REACT_TEXT,
      pairId: ids.pairId,
    });
    await sendAndRun(context, { personId: ids.personA, mode: "help", text: GOLDEN_HELP_TEXT });
    return written;
  } finally {
    await db.destroy();
  }
}

// Runs the command when this file is the process entry, with the golden path's report as its one
// argument; importing it starts nothing.
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const reportPath = process.argv[2];
  const run =
    reportPath === undefined
      ? Promise.reject(
          new ContractError(
            "golden_command_unknown",
            "Pass the golden path's report, from a run that stopped before friend-ask.",
            400,
          ),
        )
      : writeAskFixtures({
          workerUrl: process.env.DATABASE_URL_WORKER ?? "",
          reportPath,
          fixtureRoot: FIXTURE_DIR,
        });
  run.then(
    (paths) => {
      for (const path of paths) process.stdout.write(`${path}\n`);
    },
    (error: unknown) => {
      const line =
        error instanceof ContractError
          ? `${error.code}: ${error.message}`
          : `golden_failed: ${String(error)}`;
      process.stderr.write(`${line}\n`);
      process.exitCode = 1;
    },
  );
}
