import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CALL_SITE_CONFIG, lengthRetryFor } from "./call-sites.js";
import {
  buildChatRequest,
  estimateTokens,
  requestChars,
  type ChatMessage,
} from "./chat-request.js";
import { requestHash } from "./modes.js";
import {
  CALL_SITES,
  CardBuildOutput,
  ContractError,
  MODEL_OUTPUT_SCHEMAS,
  toolsForPhase,
  toStrictJsonSchema,
} from "@meet-first/contracts";

const messages: ChatMessage[] = [{ role: "user", content: "x" }];

describe("buildChatRequest", () => {
  it("D22-T1: the card body carries effort medium, max_tokens 16,000 and no stream or temperature key", () => {
    const body = buildChatRequest({
      callSite: "card",
      messages,
      schema: toStrictJsonSchema(CardBuildOutput, "dossier"),
      stream: false,
    });
    expect(Object.keys(body).sort()).toEqual([
      "max_tokens",
      "messages",
      "model",
      "reasoning_effort",
      "response_format",
    ]);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.max_tokens).toBe(16000);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: toStrictJsonSchema(CardBuildOutput, "dossier"),
    });
  });

  it("D62-T2: every call site sends its own effort and the two judges send temperature 0", () => {
    const callSites = CALL_SITES.filter(
      (callSite) => callSite !== "self_test" && callSite !== "comic_image",
    );
    for (const callSite of callSites) {
      const config = CALL_SITE_CONFIG[callSite];
      const body = buildChatRequest({ callSite, messages, stream: config.streams });
      expect(body.reasoning_effort).toBe(config.effort);
      if (
        callSite === "quiz_judge" ||
        callSite === "brief_support_judge" ||
        callSite === "ask_support_judge"
      )
        expect(body.temperature).toBe(0);
      else expect(Object.keys(body)).not.toContain("temperature");
    }
  });

  it("R3.1-T2: the self-test bodies of every model output schema hash to fixture file names", () => {
    for (const [name, schema] of Object.entries(MODEL_OUTPUT_SCHEMAS)) {
      const body = buildChatRequest({
        callSite: "self_test",
        messages: [{ role: "user", content: "ok" }],
        schema: toStrictJsonSchema(schema, name),
        stream: false,
      });
      expect(Object.keys(body).sort()).toEqual([
        "max_tokens",
        "messages",
        "model",
        "response_format",
      ]);
      expect(body.max_tokens).toBe(1);
      expect(
        existsSync(`packages/evals/fixtures/model-replies/self_test/${requestHash(body)}.json`),
      ).toBe(true);
    }
  });

  it("D63-T1: the length retry body is effort minimal with the larger of 8,000 and the call site's own max_tokens: 16,000 for the card, 8,000 for the 200-token question check", () => {
    const card = buildChatRequest({
      callSite: "card",
      messages,
      schema: toStrictJsonSchema(CardBuildOutput, "dossier"),
      stream: false,
      override: lengthRetryFor("card"),
    });
    const check = buildChatRequest({
      callSite: "question_check",
      messages,
      stream: false,
      override: lengthRetryFor("question_check"),
    });
    expect(card.reasoning_effort).toBe("minimal");
    expect(card.max_tokens).toBe(16000);
    expect(check.reasoning_effort).toBe("minimal");
    expect(check.max_tokens).toBe(8000);
  });

  it("D37-T1: a request without tools carries no tools key, and a streamed one carries the stream options", () => {
    const first = buildChatRequest({ callSite: "speech", messages, stream: true });
    const tools = toolsForPhase("open", 2) ?? [];
    const second = buildChatRequest({ callSite: "speech", messages, stream: true, tools });
    expect(Object.keys(first)).not.toContain("tools");
    expect(first.stream).toBe(true);
    expect(first.stream_options).toEqual({ include_usage: true });
    expect(second.tools).toEqual(tools);
    expect(tools).toHaveLength(1);
  });

  it("D41-T1: prompt_cache_key appears only when given", () => {
    const withKey = buildChatRequest({
      callSite: "speech",
      messages,
      stream: true,
      promptCacheKey: "meeting:m1:a",
    });
    const withoutKey = buildChatRequest({ callSite: "speech", messages, stream: true });
    expect(withKey.prompt_cache_key).toBe("meeting:m1:a");
    expect(Object.keys(withoutKey)).not.toContain("prompt_cache_key");
  });
});

describe("token estimates", () => {
  it("R3.3-T1: estimateTokens assumes 1.33 characters per token before calibration", () => {
    expect(estimateTokens(1330, null)).toBe(1000);
    expect(estimateTokens(0, null)).toBe(1);
    expect(estimateTokens(1000, 4)).toBe(250);
    expect(estimateTokens(1001, 4)).toBe(251);
  });

  it("R3.5-T1: requestChars counts message text and tool definitions for the estimate written before the call", () => {
    const body = {
      messages: [
        { role: "user", content: "abc" },
        { role: "assistant", content: null },
        { role: "user", content: "de" },
      ],
    };
    expect(requestChars(body)).toBe(5);
    expect(requestChars({ ...body, tools: [{ a: 1 }] })).toBe(
      5 + JSON.stringify([{ a: 1 }]).length,
    );
    expect(JSON.stringify([{ a: 1 }]).length + 5).toBe(14);
    let caught: unknown;
    try {
      requestChars({ model: "x" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContractError);
    expect((caught as ContractError).code).toBe("request_body_invalid");
  });
});
