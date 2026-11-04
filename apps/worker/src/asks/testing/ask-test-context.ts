// The job context of one ask test: a replay model client over a new temporary fixture folder, which writes each missing fixture from
// the test's script right before the client reads it (a fake fixture folder), and the scripted replies.
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { ContractError, LIMITER_RETRY_MS, type CallSite } from "@meet-first/contracts";
import type { Database } from "@meet-first/db";
import {
  LimiterBusy,
  makeLlmClient,
  requestHash,
  type ChatMessage,
  type CompleteArgs,
  type LlmClient,
} from "@meet-first/llm";
import { makeReplayFolder } from "@meet-first/llm/testing";
import type { JobContext } from "../../job-context.js";
import {
  chatBodyFor,
  scriptedRecordedCall,
  structuredReplyLayout,
} from "../../meetings/testing/index.js";
import { makeTestJobContext, type EnqueuedJob } from "../../testing/index.js";

// The four call sites of the run_ask job.
export type AskCallSite =
  | "question_check"
  | "search_words"
  | "persona_answer"
  | "ask_support_judge";
// The replies of one ask test: question-check and support-check replies in call order, persona replies by the subject's display name.
// searchWords holds the search-words replies in call order; with none left, the call fails and the job searches with the ask's text.
// limiterBusy makes the next `times` calls of one call site throw LimiterBusy before they reach the client (a fake full window).
export type AskReplyScript = {
  questionCheck: unknown[];
  searchWords?: unknown[];
  personaAnswers: Record<string, unknown>;
  judge: unknown[];
  limiterBusy?: { callSite: AskCallSite; times: number };
};
// One call that reached the replay client: its call site and its user message.
export type SeenCall = { callSite: CallSite; user: string };
// What an ask test gets: the job context, the jobs it enqueued, the calls it saw in order, and the call that removes its fixture folder.
export type AskTestContext = {
  context: JobContext;
  enqueued: EnqueuedJob[];
  calls: SeenCall[];
  close: () => Promise<void>;
};

// The question check's reply for an allowed help search; romantic is the field of question-check v5.
export const ALLOWED_HELP = {
  allowed: true,
  reason: "An ask about who could probably help with a problem.",
  kind: "help",
  romantic: false,
};
// The question check's reply for an allowed friend ask.
export const ALLOWED_REACT = {
  allowed: true,
  reason: "An ask about how one person would probably react to news.",
  kind: "situation",
  romantic: false,
};
// The question check's reply for a help search about dating: allowed, kind help, marked romantic.
export const ROMANTIC_HELP = {
  allowed: true,
  reason: "An ask about who might enjoy a date.",
  kind: "help",
  romantic: true,
};
// The question check's reply for a friend ask about a date: allowed, kind situation, marked romantic.
export const ROMANTIC_REACT = {
  allowed: true,
  reason: "An ask about how one person would probably feel about a date.",
  kind: "situation",
  romantic: true,
};
// The question check's refusal of a score (refusal 1 of the question-check prompt).
export const REFUSED = {
  allowed: false,
  reason:
    "Meet First never scores or guarantees; ask: would we enjoy a first date, and where would we click?",
  kind: "get_along",
  romantic: false,
};
// Kai's claim about the validation split; its quote is in Kai's turn 0, his item 1.
export const KAI_VALIDATION_CLAIM = {
  text: "Kai fixes a validation split before the first epoch.",
  quote: "gets a fixed validation split before the first epoch",
  turn_id: "0",
  lang: "en",
  gloss: "Kai fixes a validation split before the first epoch.",
};
// Kai's claim about his lab notebook; its quote is in Kai's turn 1, his item 2, and its label has the t: form.
export const KAI_NOTEBOOK_CLAIM = {
  text: "Kai logs the settings of every run.",
  quote: "a lab notebook with the learning rate and batch size",
  turn_id: "t:1",
  lang: "en",
  gloss: "Kai logs the settings of every run.",
};
// Kai's help answer: two claims whose quotes are in his items 1 and 2.
export const KAI_HELP = {
  answer:
    "Kai could probably help: Kai fixes a validation split before training and logs every run.",
  has_sign: true,
  claims: [KAI_VALIDATION_CLAIM, KAI_NOTEBOOK_CLAIM],
};
// Kai's help answer with its second quote changed by one word, so the quote is not found in turn 1.
export const KAI_ALTERED = {
  answer: KAI_HELP.answer,
  has_sign: true,
  claims: [
    KAI_VALIDATION_CLAIM,
    { ...KAI_NOTEBOOK_CLAIM, quote: "a lab notebook with the learning rate and the batch size" },
  ],
};
// Kai's help answer that rests only on his item 1.
export const KAI_PUBLIC = {
  answer: "Kai could probably help: Kai fixes a validation split before training.",
  has_sign: true,
  claims: [KAI_VALIDATION_CLAIM],
};
// Kai's friend answer: one claim from his item 3 (turn 2) and one from turn 3, which only recall shows.
export const KAI_REACT = {
  answer:
    "Kai would probably ask for more notice: Kai keeps Fridays for baking and wants two days notice before a demo moves.",
  has_sign: true,
  claims: [
    {
      text: "Kai keeps Fridays for baking with neighbours.",
      quote: "On Fridays I bake sourdough with my neighbours",
      turn_id: "2",
      lang: "en",
      gloss: "Kai keeps Fridays for baking with neighbours.",
    },
    {
      text: "Kai wants two days notice before a demo moves.",
      quote: "so I ask for two days notice",
      turn_id: "3",
      lang: "en",
      gloss: "Kai wants two days notice before a demo moves.",
    },
  ],
};
// Lena's help answer: one claim from her item 2 (turn 1).
export const LENA_HELP = {
  answer: "Lena would probably start by plotting gradient norms per layer.",
  has_sign: true,
  claims: [
    {
      text: "Lena plots gradient norms when training stalls.",
      quote: "Plotting gradient norms per layer is the first thing I do",
      turn_id: "1",
      lang: "en",
      gloss: "Lena plots gradient norms when training stalls.",
    },
  ],
};
// Lena's friend answer: one claim from her item 1 (turn 0) and one from turn 3, which no item quotes and recall does not show.
export const LENA_REACT = {
  answer: "Lena would probably want the plans written down first.",
  has_sign: true,
  claims: [
    {
      text: "Lena reviews work the morning it arrives.",
      quote: "I review pull requests the same morning they arrive",
      turn_id: "0",
      lang: "en",
      gloss: "Lena reviews work the morning it arrives.",
    },
    {
      text: "Lena prefers written agendas to surprise calls.",
      quote: "I prefer written agendas to surprise calls",
      turn_id: "3",
      lang: "en",
      gloss: "Lena prefers written agendas to surprise calls.",
    },
  ],
};
// Noor's help answer: one claim from her item 1 (turn 0).
export const NOOR_HELP = {
  answer: "Noor could probably help: Noor tunes warmup schedules for long runs.",
  has_sign: true,
  claims: [
    {
      text: "Noor tunes warmup schedules for long runs.",
      quote: "I tune learning rate warmup schedules",
      turn_id: "0",
      lang: "en",
      gloss: "Noor tunes warmup schedules for long runs.",
    },
  ],
};
// Rosa's help answer: one Greek claim from her item 1 (turn 0).
export const ROSA_HELP = {
  answer: "Rosa would probably enjoy a salsa evening.",
  has_sign: true,
  claims: [
    {
      text: "Rosa dances salsa on Thursday evenings.",
      quote: "Μου αρέσει να χορεύω σάλσα κάθε Πέμπτη βράδυ",
      turn_id: "0",
      lang: "el",
      gloss: "Rosa likes to dance salsa every Thursday evening.",
    },
  ],
};

// Builds the job context of one ask test over db, the worker database, with this script and clock (the real client in replay mode).
export async function makeAskTestContext(options: {
  db: Kysely<Database>;
  script: AskReplyScript;
  now?: () => Date;
}): Promise<AskTestContext> {
  const now = options.now ?? (() => new Date());
  const base = makeTestJobContext({ db: options.db, now });
  const folder = await makeReplayFolder([]);
  const replay = makeLlmClient({
    db: options.db,
    env: base.context.env,
    now,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    fixtureRoot: folder.root,
  });
  const calls: SeenCall[] = [];
  const llm = scriptedAskClient(replay, options.script, { fixtureRoot: folder.root, now, calls });
  return {
    context: { ...base.context, llm },
    enqueued: base.enqueued,
    calls,
    close: folder.remove,
  };
}

// How many calls of one call site reached the replay client.
export function countCalls(test: AskTestContext, callSite: AskCallSite): number {
  return test.calls.filter((call) => call.callSite === callSite).length;
}

// The user messages of one call site's calls, in call order.
export function userTexts(test: AskTestContext, callSite: AskCallSite): string[] {
  return test.calls.filter((call) => call.callSite === callSite).map((call) => call.user);
}

// The support-check reply that backs each of count items, indexes 0 to count - 1.
export function allSupported(count: number): {
  lines: Array<{ index: number; supported: boolean; reason: string }>;
} {
  return {
    lines: Array.from(Array(count).keys(), (index) => ({
      index,
      supported: true,
      reason: "The quote carries the statement.",
    })),
  };
}

// The client wrapper: the fake full window first, then the scripted fixture, then the real replay client.
function scriptedAskClient(
  client: LlmClient,
  script: AskReplyScript,
  scope: { fixtureRoot: string; now: () => Date; calls: SeenCall[] },
): LlmClient {
  let busyLeft = script.limiterBusy?.times ?? 0;
  const refuse = (): Promise<never> =>
    Promise.reject(
      new ContractError(
        "script_call_site_unknown",
        "The ask test client answers complete calls only. Add the call to ask-test-context.ts.",
        500,
      ),
    );
  return {
    complete: async (args) => {
      if (script.limiterBusy?.callSite === args.callSite && busyLeft > 0) {
        busyLeft -= 1;
        throw new LimiterBusy(scope.now().getTime() + LIMITER_RETRY_MS);
      }
      scope.calls.push({ callSite: args.callSite, user: userTextOf(args.messages) });
      await writeScriptedFixture(args, script, scope.fixtureRoot);
      return client.complete(args);
    },
    stream: refuse,
    image: refuse,
  };
}

// Writes the fixture of one request from the script unless it exists. With no scripted reply it writes nothing, so the replay client
// throws replay_fixture_missing, which the job treats as a failed call.
async function writeScriptedFixture(
  args: CompleteArgs,
  script: AskReplyScript,
  fixtureRoot: string,
): Promise<void> {
  const body = chatBodyFor(args, false);
  const path = join(fixtureRoot, args.callSite, requestHash(body) + ".json");
  if (
    await access(path).then(
      () => true,
      () => false,
    )
  )
    return;
  const reply = scriptedReply(args, script);
  if (reply === undefined) return;
  await mkdir(join(fixtureRoot, args.callSite), { recursive: true });
  const recorded = scriptedRecordedCall(
    { callSite: args.callSite, promptVersion: args.promptVersion, body },
    structuredReplyLayout(reply),
  );
  await writeFile(path, JSON.stringify(recorded, null, 2) + "\n");
}

// The scripted reply of one request: the next check or support-check reply, or the persona reply of the subject the request names.
function scriptedReply(args: CompleteArgs, script: AskReplyScript): unknown {
  if (args.callSite === "question_check") return script.questionCheck.shift();
  if (args.callSite === "ask_support_judge") return script.judge.shift();
  if (args.callSite === "search_words") return script.searchWords?.shift();
  if (args.callSite === "persona_answer")
    return script.personaAnswers[subjectNameOf(userTextOf(args.messages))];
  throw new ContractError(
    "script_call_site_unknown",
    "The ask test script covers question_check, search_words, persona_answer and ask_support_judge only.",
    500,
  );
}

// The text of the request's user message, or "" when it has none.
function userTextOf(messages: readonly ChatMessage[]): string {
  const user = messages.find(
    (message): message is Extract<ChatMessage, { role: "user" }> => message.role === "user",
  );
  return user === undefined ? "" : user.content;
}

// The subject's display name from the "your human:" line of a persona request, or "" when the line is missing.
function subjectNameOf(user: string): string {
  return /^<people>your human: (.*)$/m.exec(user)?.[1] ?? "";
}
