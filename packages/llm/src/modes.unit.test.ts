import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractError, MODEL_OUTPUT_SCHEMAS, RecordedCall } from "@meet-first/contracts";
import { describe, expect, it, vi } from "vitest";
import { assertModeAllowed, requestHash, runInMode, type LlmRequest } from "./modes.js";
import { makeReplayFolder } from "./testing/replay-folder.js";

// A fake fixture folder holds the recorded replies for these tests; no live call is made.
const BODY = {
  model: "muse-spark-1.3",
  messages: [{ role: "user", content: "ok" }],
  max_tokens: 1,
};
const REQUEST: LlmRequest = { callSite: "self_test", promptVersion: "v1", body: BODY };
const USAGE = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 };
const REPLY_RESPONSE: Record<string, unknown> = {
  choices: [{ message: { content: "{" }, finish_reason: "length" }],
};
const RECORDED: RecordedCall = {
  callSite: "self_test",
  promptVersion: "v1",
  requestHash: requestHash(BODY),
  request: REQUEST,
  response: REPLY_RESPONSE,
  usage: USAGE,
  recordedAt: null,
  handWritten: true,
};
const SIGNAL = new AbortController().signal;
const SELF_TEST_FIXTURES = fileURLToPath(
  new URL("../../evals/fixtures/model-replies/self_test", import.meta.url),
);

describe("LLM modes", () => {
  it("D74-T1: replay returns the fixture and never calls live (uses a fake fixture folder)", async () => {
    const folder = await makeReplayFolder([RECORDED]);
    const live = vi.fn(() => Promise.reject(new Error("live must not run in replay")));

    const reply = await runInMode({
      mode: "replay",
      fixtureRoot: folder.root,
      live,
      request: REQUEST,
      signal: SIGNAL,
    });
    await folder.remove();

    expect(reply.response).toEqual(RECORDED.response);
    expect(reply.usage).toEqual(USAGE);
    expect(live).not.toHaveBeenCalled();
  });

  it("D74-T2: replay with no fixture throws replay_fixture_missing (uses a fake fixture folder)", async () => {
    const folder = await makeReplayFolder([]);
    const live = vi.fn(() => Promise.reject(new Error("live must not run in replay")));

    const attempt = runInMode({
      mode: "replay",
      fixtureRoot: folder.root,
      live,
      request: REQUEST,
      signal: SIGNAL,
    });
    const caught = await attempt.catch((error: unknown) => error);
    await folder.remove();

    expect(caught).toBeInstanceOf(ContractError);
    expect(caught).toMatchObject({ code: "replay_fixture_missing" });
  });

  it("D74-T3: record calls live and writes a RecordedCall with recordedAt set (uses a fake fixture folder and a fake live caller)", async () => {
    const folder = await makeReplayFolder([]);
    const live = vi.fn(() =>
      Promise.resolve({
        response: REPLY_RESPONSE,
        usage: USAGE,
        requestId: "req_fake",
        httpStatus: 200,
      }),
    );

    await runInMode({
      mode: "record",
      fixtureRoot: folder.root,
      live,
      request: REQUEST,
      signal: SIGNAL,
    });
    const file = join(folder.root, "self_test", `${requestHash(BODY)}.json`);
    const written = existsSync(file)
      ? RecordedCall.parse(JSON.parse(readFileSync(file, "utf8")))
      : undefined;
    await folder.remove();

    expect(written?.recordedAt).not.toBeNull();
    expect(written?.handWritten).toBeUndefined();
  });

  it("D74-T4: production refuses replay", () => {
    const refusal = (): void => {
      assertModeAllowed("replay", "production");
    };

    expect(refusal).toThrow(ContractError);
    expect(() => {
      assertModeAllowed("live", "production");
    }).not.toThrow();
  });

  it("D74-T5: requestHash is stable under key order", () => {
    const sortedKeys = { b: 1, a: { d: 2, c: 3 } };
    const otherOrder = { a: { c: 3, d: 2 }, b: 1 };

    const first = requestHash(sortedKeys);
    const second = requestHash(otherOrder);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("R3.1-T6: the self-test fixtures are named by the hash of their request body, one per model output schema", () => {
    const files = readdirSync(SELF_TEST_FIXTURES).filter((name) => name.endsWith(".json"));

    const calls = files.map((name) => ({
      name,
      call: RecordedCall.parse(JSON.parse(readFileSync(join(SELF_TEST_FIXTURES, name), "utf8"))),
    }));

    expect(files).toHaveLength(Object.keys(MODEL_OUTPUT_SCHEMAS).length);
    for (const { name, call } of calls) {
      expect(name).toBe(`${requestHash(call.request.body)}.json`);
      expect(call.requestHash).toBe(requestHash(call.request.body));
      expect(call.callSite).toBe("self_test");
    }
  });
});
