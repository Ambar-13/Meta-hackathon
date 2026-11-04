import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { ContractError, type RecordedCall } from "@meet-first/contracts";
import { makeDatabase, numberFromPostgres, POOL_SIZE, type Database } from "@meet-first/db";
import {
  asPerson,
  createPairedMeeting,
  createTestPerson,
  freshTestDatabase,
  type TestDatabase,
} from "@meet-first/db/testing";
import { buildChatRequest, type ChatMessage } from "./chat-request.js";
import { makeLlmClient, type CompleteArgs, type StreamArgs } from "./client.js";
import { readLedgerWindow, readMeetingTokens } from "./ledger.js";
import { requestHash, type LiveCaller } from "./modes.js";
import {
  fakeLiveCaller,
  makeReplayFolder,
  testWorkerEnv,
  type ScriptedReply,
} from "./testing/index.js";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const liveEnv = testWorkerEnv("live");
const replayEnv = testWorkerEnv("replay");
const ZERO_USAGE = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 };
const noSleep = (): Promise<void> => Promise.resolve();
const half = (): number => 0.5;

let fresh: TestDatabase;
let workerDb: Kysely<Database>;
beforeEach(async () => {
  fresh = await freshTestDatabase();
  workerDb = makeDatabase(fresh.workerUrl, POOL_SIZE.test);
});
afterEach(async () => {
  await workerDb.destroy();
  await fresh.drop();
});

// One chat completions reply with one choice.
function okResponse(
  content: string,
  finish: "stop" | "length" | null = "stop",
): Record<string, unknown> {
  return {
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
  };
}

// The arguments of one card call: 1,330 characters, which estimate at 1,000 tokens.
function cardArgs(personId: string | null, meetingId: string | null = null): CompleteArgs {
  const messages: ChatMessage[] = [{ role: "user", content: "x".repeat(1330) }];
  return { callSite: "card", promptVersion: "v1", messages, ledger: { personId, meetingId } };
}

// The arguments of one streamed speech call with the same 1,330 characters, whose hooks keep
// nothing.
function speechArgs(personId: string): StreamArgs {
  return {
    ...cardArgs(personId),
    callSite: "speech",
    onDelta: () => Promise.resolve(),
    onFirstToken: () => Promise.resolve(),
  };
}

// The ledger rows of one person, in start order, read as that person.
async function ledgerRows(personId: string): Promise<Array<Record<string, unknown>>> {
  return asPerson(workerDb, personId, (trx) =>
    trx.selectFrom("ledger").selectAll().orderBy("started_at").orderBy("id").execute(),
  );
}

// The status column of each row, in order.
function statusesOf(rows: Array<Record<string, unknown>>): unknown[] {
  return rows.map((row) => row.status);
}

// The code of the error a promise rejects with, or an empty string when it resolves.
async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "";
  } catch (error) {
    return error instanceof ContractError ? error.code : "not a contract error";
  }
}

describe("the client writes the ledger and retries", () => {
  it("R3.5-T2: the ledger row exists with est_tokens before the vendor answers (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    let during: { sumEstTokens: number; callCount: number; imageCallCount: number } | undefined;
    const live: LiveCaller = async () => {
      during = await readLedgerWindow(workerDb, 600);
      return { response: okResponse("ok"), usage: ZERO_USAGE, requestId: "r1", httpStatus: 200 };
    };
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    await client.complete(cardArgs(person.personId));
    expect(during).toEqual({ sumEstTokens: 1000, callCount: 1, imageCallCount: 0 });
    const rows = await ledgerRows(person.personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      call_site: "card",
      est_tokens: 1000,
      effort: "medium",
      llm_mode: "live",
      model: "muse-spark-1.3",
      status: "ok",
      http_status: 200,
      request_id: "r1",
      person_id: person.personId,
      meeting_id: null,
    });
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  it("R3.5-T3: a 429, a 503 and a success are three ledger rows (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const script: ScriptedReply[] = [{ status: 429 }, { status: 503 }, { status: 200 }];
    const { live, calls } = fakeLiveCaller(script);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    const result = await client.complete(cardArgs(person.personId));
    expect(calls).toHaveLength(3);
    const rows = await ledgerRows(person.personId);
    expect(statusesOf(rows)).toEqual(["error", "error", "ok"]);
    expect(rows.map((row) => row.http_status)).toEqual([429, 503, 200]);
    expect(result.finishReason).toBe("stop");
  });

  it("D63-T3: a cut card is retried once at effort minimal with its own max_tokens 16,000, not less (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const script: ScriptedReply[] = [
      { status: 200, body: okResponse("cut", "length") },
      { status: 200 },
    ];
    const { live, calls } = fakeLiveCaller(script);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    const result = await client.complete(cardArgs(person.personId));
    expect(calls[1]?.body.max_tokens).toBe(16000);
    expect(calls[1]?.body.reasoning_effort).toBe("minimal");
    expect(statusesOf(await ledgerRows(person.personId))).toEqual(["error", "ok"]);
    expect((await ledgerRows(person.personId)).map((row) => row.http_status)).toEqual([200, 200]);
    expect(result.finishReason).toBe("stop");
  });

  it("D63-T4: a second length reply throws model_output_cut (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const script: ScriptedReply[] = [
      { status: 200, body: okResponse("a", "length") },
      { status: 200, body: okResponse("b", "length") },
    ];
    const { live } = fakeLiveCaller(script);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    expect(await codeOf(client.complete(cardArgs(person.personId)))).toBe("model_output_cut");
    expect(statusesOf(await ledgerRows(person.personId))).toEqual(["error", "error"]);
  });

  it("R10.3-T4: a call whose deadline fires is a timeout row and is retried (fake live caller, fake deadline)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    let made = 0;
    const timeoutSignal = (): AbortSignal => {
      const controller = new AbortController();
      made += 1;
      if (made === 1)
        setTimeout(() => {
          controller.abort();
        }, 10);
      return controller.signal;
    };
    const { live } = fakeLiveCaller([{ status: 200, delayMs: 50 }, { status: 200 }]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
      timeoutSignal,
    });
    await client.complete(cardArgs(person.personId));
    expect(statusesOf(await ledgerRows(person.personId))).toEqual(["timeout", "ok"]);
  });

  it("D74-T5: replay answers from the fixture, records llm_mode replay and never calls live (fake fixture folder)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const args = cardArgs(person.personId);
    const body = buildChatRequest({ callSite: "card", messages: args.messages, stream: false });
    const usage = { promptTokens: 10, cachedTokens: 0, completionTokens: 2, reasoningTokens: 0 };
    const recorded: RecordedCall = {
      callSite: "card",
      promptVersion: "v1",
      requestHash: requestHash(body),
      request: { callSite: "card", promptVersion: "v1", body },
      response: okResponse("from fixture"),
      usage,
      recordedAt: null,
      handWritten: true,
    };
    const folder = await makeReplayFolder([recorded]);
    try {
      const client = makeLlmClient({
        db: workerDb,
        env: replayEnv,
        now: () => NOW,
        sleep: noSleep,
        random: half,
        fixtureRoot: folder.root,
        live: () => Promise.reject(new Error("fake live caller: replay must not call live")),
      });
      const result = await client.complete(args);
      expect(result.text).toBe("from fixture");
      expect(result.usage).toEqual(usage);
      const rows = await ledgerRows(person.personId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ llm_mode: "replay", status: "ok", prompt_tokens: 10 });
    } finally {
      await folder.remove();
    }
  });

  it("D74-T6: a replay miss writes the request to the miss folder and throws replay_fixture_missing (fake fixture folder)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const args = cardArgs(person.personId);
    const body = buildChatRequest({ callSite: "card", messages: args.messages, stream: false });
    const folder = await makeReplayFolder([]);
    const path = join(
      tmpdir(),
      "meet-first-replay-misses",
      "card",
      `${requestHash(body)}.request.json`,
    );
    rmSync(path, { force: true });
    try {
      const client = makeLlmClient({
        db: workerDb,
        env: replayEnv,
        now: () => NOW,
        sleep: noSleep,
        random: half,
        fixtureRoot: folder.root,
        live: () => Promise.reject(new Error("unused")),
      });
      expect(await codeOf(client.complete(args))).toBe("replay_fixture_missing");
      expect(existsSync(path)).toBe(true);
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        callSite: "card",
        promptVersion: "v1",
        body,
      });
    } finally {
      rmSync(path, { force: true });
      await folder.remove();
    }
  });

  it("R10.3-T5: a stream whose first token misses its deadline is retried once (fake live caller, fake deadline)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    let hasMadeGate = false;
    const timeoutSignal = (ms: number): AbortSignal => {
      const controller = new AbortController();
      if (ms === 45_000 && !hasMadeGate) {
        hasMadeGate = true;
        setTimeout(() => {
          controller.abort();
        }, 10);
      }
      return controller.signal;
    };
    const deltas: string[] = [];
    const { live } = fakeLiveCaller([
      { status: 200, delayMs: 100 },
      { status: 200, body: okResponse("Hi") },
    ]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
      timeoutSignal,
    });
    const result = await client.stream({
      ...cardArgs(person.personId),
      callSite: "speech",
      onDelta: (text) => {
        deltas.push(text);
        return Promise.resolve();
      },
      onFirstToken: () => Promise.resolve(),
    });
    expect(deltas).toEqual(["Hi"]);
    expect(result.text).toBe("Hi");
    expect(statusesOf(await ledgerRows(person.personId))).toEqual(["timeout", "ok"]);
  });

  it("R10.7-T6: a stream that breaks after text was shown throws model_stream_cut and is not retried (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const deltas: string[] = [];
    const { live, calls } = fakeLiveCaller([
      { status: 200, body: okResponse("Partial text", null) },
    ]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    const code = await codeOf(
      client.stream({
        ...cardArgs(person.personId),
        callSite: "speech",
        onDelta: (text) => {
          deltas.push(text);
          return Promise.resolve();
        },
        onFirstToken: () => Promise.resolve(),
      }),
    );
    expect(deltas).toEqual(["Partial text"]);
    expect(code).toBe("model_stream_cut");
    expect(calls).toHaveLength(1);
    expect(statusesOf(await ledgerRows(person.personId))).toEqual(["error"]);
  });

  it("R10.7-T7: a cut stream with no text is retried once at the length retry (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const { live, calls } = fakeLiveCaller([
      { status: 200, body: okResponse("", null) },
      { status: 200, body: okResponse("Done") },
    ]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    const result = await client.stream({
      ...cardArgs(person.personId),
      callSite: "speech",
      onDelta: () => Promise.resolve(),
      onFirstToken: () => Promise.resolve(),
    });
    expect(result.text).toBe("Done");
    expect(calls[1]?.body.max_tokens).toBe(8000);
    expect(statusesOf(await ledgerRows(person.personId))).toEqual(["error", "ok"]);
  });

  it("R10.8-T6: a finished row stores the usage and the dollars computed at call time (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const { live } = fakeLiveCaller([
      {
        status: 200,
        usage: { promptTokens: 1000, cachedTokens: 0, completionTokens: 100, reasoningTokens: 0 },
      },
    ]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    await client.complete(cardArgs(person.personId));
    const [row] = await ledgerRows(person.personId);
    expect(row).toMatchObject({
      prompt_tokens: 1000,
      cached_tokens: 0,
      completion_tokens: 100,
      reasoning_tokens: 0,
    });
    expect(numberFromPostgres(row?.usd)).toBe(0.001675);
  });

  it("D61-T1: readMeetingTokens counts the prompt and completion tokens of a meeting's rows (fake live caller)", async () => {
    const { meetingId } = await createPairedMeeting(fresh.db);
    const usage = {
      promptTokens: 1500,
      cachedTokens: 0,
      completionTokens: 500,
      reasoningTokens: 0,
    };
    const { live } = fakeLiveCaller([
      { status: 200, usage },
      { status: 200, usage },
    ]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    await client.complete(cardArgs(null, meetingId));
    await client.complete(cardArgs(null, meetingId));
    expect(await readMeetingTokens(workerDb, meetingId)).toBe(4000);
  });

  it("R3.5-T4: a call that names neither a person nor a meeting is refused before any row (fake live caller)", async () => {
    const { live, calls } = fakeLiveCaller([{ status: 200 }]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    expect(await codeOf(client.complete(cardArgs(null, null)))).toBe("ledger_context_missing");
    expect(calls).toHaveLength(0);
    expect((await readLedgerWindow(workerDb, 600)).callCount).toBe(0);
  });
});

// The worst case of the 1,330-character card call: 1,000 estimated prompt tokens and its max_tokens
// 16,000, at 1.25 and 4.25 dollars a million.
const CARD_WORST = {
  prompt_tokens: 1000,
  cached_tokens: 0,
  completion_tokens: 16_000,
  reasoning_tokens: 0,
  usd: 0.06925,
};
// The worst case of the same text as a speech call: 1,000 estimated prompt tokens and its
// max_tokens 6,000.
const SPEECH_WORST = {
  prompt_tokens: 1000,
  cached_tokens: 0,
  completion_tokens: 6_000,
  reasoning_tokens: 0,
  usd: 0.02675,
};
// The zero usage a scripted success reports, and its dollars.
const ZERO_CHARGE = {
  prompt_tokens: 0,
  cached_tokens: 0,
  completion_tokens: 0,
  reasoning_tokens: 0,
  usd: 0,
};
// The columns of a row that counts nothing.
const NO_CHARGE = {
  prompt_tokens: null,
  cached_tokens: null,
  completion_tokens: null,
  reasoning_tokens: null,
  usd: null,
};

// The status, HTTP status, usage and dollars of each row, in order, with the dollars read as a
// number.
function chargesOf(rows: Array<Record<string, unknown>>): unknown[] {
  return rows.map((row) => ({
    status: row.status,
    http_status: row.http_status,
    prompt_tokens: row.prompt_tokens,
    cached_tokens: row.cached_tokens,
    completion_tokens: row.completion_tokens,
    reasoning_tokens: row.reasoning_tokens,
    usd: row.usd === null ? null : numberFromPostgres(row.usd),
  }));
}

describe("a failed attempt that Meta may have billed is counted", () => {
  it("W3-LLM-T2: a live call whose deadline fires is a timeout row priced at its estimate and max_tokens (fake live caller, fake deadline)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    let made = 0;
    const timeoutSignal = (): AbortSignal => {
      const controller = new AbortController();
      made += 1;
      if (made === 1)
        setTimeout(() => {
          controller.abort();
        }, 10);
      return controller.signal;
    };
    const { live } = fakeLiveCaller([{ status: 200, delayMs: 50 }, { status: 200 }]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
      timeoutSignal,
    });
    await client.complete(cardArgs(person.personId));
    expect(chargesOf(await ledgerRows(person.personId))).toEqual([
      { status: "timeout", http_status: null, ...CARD_WORST },
      { status: "ok", http_status: 200, ...ZERO_CHARGE },
    ]);
  });

  it("W3-LLM-T3: a stream aborted at the first-token gate is a timeout row priced at its estimate and max_tokens (fake live caller, fake deadline)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    let hasMadeGate = false;
    const timeoutSignal = (ms: number): AbortSignal => {
      const controller = new AbortController();
      if (ms === 45_000 && !hasMadeGate) {
        hasMadeGate = true;
        setTimeout(() => {
          controller.abort();
        }, 10);
      }
      return controller.signal;
    };
    const { live } = fakeLiveCaller([
      { status: 200, delayMs: 100 },
      { status: 200, body: okResponse("Hi") },
    ]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
      timeoutSignal,
    });
    const result = await client.stream(speechArgs(person.personId));
    expect(result.text).toBe("Hi");
    expect(chargesOf(await ledgerRows(person.personId))).toEqual([
      { status: "timeout", http_status: null, ...SPEECH_WORST },
      { status: "ok", http_status: 200, ...ZERO_CHARGE },
    ]);
  });

  it("W3-LLM-T4: a call that throws a plain Error is an error row priced at its estimate and max_tokens, streamed or not, live or record (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const live: LiveCaller = () =>
      Promise.reject(new Error("fake live caller: the connection reset"));
    const folder = await makeReplayFolder([]);
    try {
      const client = makeLlmClient({
        db: workerDb,
        env: liveEnv,
        now: () => NOW,
        sleep: noSleep,
        random: half,
        live,
      });
      const recording = makeLlmClient({
        db: workerDb,
        env: testWorkerEnv("record"),
        now: () => NOW,
        sleep: noSleep,
        random: half,
        fixtureRoot: folder.root,
        live,
      });
      expect(await codeOf(client.complete(cardArgs(person.personId)))).toBe("not a contract error");
      expect(await codeOf(client.stream(speechArgs(person.personId)))).toBe("not a contract error");
      expect(await codeOf(recording.complete(cardArgs(person.personId)))).toBe(
        "not a contract error",
      );
    } finally {
      await folder.remove();
    }
    const rows = await ledgerRows(person.personId);
    expect(rows.map((row) => [row.call_site, row.llm_mode])).toEqual([
      ["card", "live"],
      ["speech", "live"],
      ["card", "record"],
    ]);
    expect(chargesOf(rows)).toEqual([
      { status: "error", http_status: null, ...CARD_WORST },
      { status: "error", http_status: null, ...SPEECH_WORST },
      { status: "error", http_status: null, ...CARD_WORST },
    ]);
  });

  it("W3-LLM-T5: a vendor 400 is an error row with its status and no usage or dollars, streamed or not (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const { live, calls } = fakeLiveCaller([{ status: 400 }, { status: 400 }]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    expect(await codeOf(client.complete(cardArgs(person.personId)))).toBe("not a contract error");
    expect(await codeOf(client.stream(speechArgs(person.personId)))).toBe("not a contract error");
    expect(calls).toHaveLength(2);
    expect(chargesOf(await ledgerRows(person.personId))).toEqual([
      { status: "error", http_status: 400, ...NO_CHARGE },
      { status: "error", http_status: 400, ...NO_CHARGE },
    ]);
  });

  it("W3-LLM-T6: a replay miss is an error row with no usage or dollars, streamed or not (fake fixture folder)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const card = cardArgs(person.personId);
    const speech = speechArgs(person.personId);
    const missFiles = [
      join(
        tmpdir(),
        "meet-first-replay-misses",
        "card",
        `${requestHash(buildChatRequest({ callSite: "card", messages: card.messages, stream: false }))}.request.json`,
      ),
      join(
        tmpdir(),
        "meet-first-replay-misses",
        "speech",
        `${requestHash(buildChatRequest({ callSite: "speech", messages: speech.messages, stream: true }))}.request.json`,
      ),
    ];
    const folder = await makeReplayFolder([]);
    try {
      const client = makeLlmClient({
        db: workerDb,
        env: replayEnv,
        now: () => NOW,
        sleep: noSleep,
        random: half,
        fixtureRoot: folder.root,
        live: () => Promise.reject(new Error("fake live caller: replay must not call live")),
      });
      expect(await codeOf(client.complete(card))).toBe("replay_fixture_missing");
      expect(await codeOf(client.stream(speech))).toBe("replay_fixture_missing");
    } finally {
      for (const path of missFiles) rmSync(path, { force: true });
      await folder.remove();
    }
    expect(chargesOf(await ledgerRows(person.personId))).toEqual([
      { status: "error", http_status: null, ...NO_CHARGE },
      { status: "error", http_status: null, ...NO_CHARGE },
    ]);
  });

  it("W3-LLM-T7: an image call that throws keeps no usage or dollars, since Meta bills an image only when it is returned (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    const live: LiveCaller = () =>
      Promise.reject(new Error("fake live caller: the connection reset"));
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    expect(
      await codeOf(
        client.image({
          callSite: "comic_image",
          prompt: "A panel.",
          ledger: { personId: person.personId, meetingId: null },
        }),
      ),
    ).toBe("not a contract error");
    expect(chargesOf(await ledgerRows(person.personId))).toEqual([
      { status: "error", http_status: null, ...NO_CHARGE },
    ]);
  });

  it("W3-LLM-T9: a 200 reply with usage but no choices is an error row priced at the usage Meta billed (fake live caller)", async () => {
    const person = await createTestPerson(fresh.db, "Client Test");
    // The card measured on the live API on 27 Oct 2026: 6,646 x 1.25 + 2,716 x 4.25 per million,
    // rounded to 0.019851; reasoning sits inside completion.
    const usage = {
      promptTokens: 6646,
      cachedTokens: 0,
      completionTokens: 2716,
      reasoningTokens: 2417,
    };
    const body = {
      id: "chatcmpl-no-choices",
      usage: {
        prompt_tokens: 6646,
        completion_tokens: 2716,
        completion_tokens_details: { reasoning_tokens: 2417 },
      },
    };
    const { live, calls } = fakeLiveCaller([{ status: 200, body, usage }]);
    const client = makeLlmClient({
      db: workerDb,
      env: liveEnv,
      now: () => NOW,
      sleep: noSleep,
      random: half,
      live,
    });
    expect(await codeOf(client.complete(cardArgs(person.personId)))).toBe("model_reply_invalid");
    expect(calls).toHaveLength(1);
    const rows = await ledgerRows(person.personId);
    expect(rows.map((row) => row.request_id)).toEqual(["fake-0"]);
    expect(chargesOf(rows)).toEqual([
      {
        status: "error",
        http_status: 200,
        prompt_tokens: 6646,
        cached_tokens: 0,
        completion_tokens: 2716,
        reasoning_tokens: 2417,
        usd: 0.019851,
      },
    ]);
  });
});
