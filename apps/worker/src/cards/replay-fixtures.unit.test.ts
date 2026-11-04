import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CardBuildOutput, type CallSite, type RecordedCall } from "@meet-first/contracts";
import { requestHash, type LlmRequest } from "@meet-first/llm";
import {
  cardCase,
  cardCaseCalls,
  cardCaseTurns,
  CARD_FIXTURE_CASES,
  fixtureRequest,
  goldenPathReply,
  GOLDEN_PATH_KINDS,
  namesCaseCalls,
  NAMES_FIXTURE_CASES,
  replyResponse,
} from "../testing/index.js";
import { loadRecordedReply, recordedReplyPath } from "../testing/recorded-replies.js";
import { cardCall, namesPassCall, verifyItems } from "./index.js";
import { requestChars } from "@meet-first/llm";

// The reply a fixture holds: the response object and the usage it reports.
type FixtureReply = { response: Record<string, unknown>; usage: RecordedCall["usage"] };

// Makes the miss files of one request, as the fixture authoring loop reads them, and returns the
// message that names the write-fixture command to run.
function missing(callSite: CallSite, request: LlmRequest, reply: FixtureReply): string {
  const hash = requestHash(request.body);
  const folder = join(tmpdir(), "meet-first-fixture-requests", callSite);
  mkdirSync(folder, { recursive: true });
  const requestPath = join(folder, `${hash}.request.json`);
  const responsePath = join(folder, `${hash}.response.json`);
  writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  writeFileSync(
    responsePath,
    `${JSON.stringify({ response: reply.response, usage: reply.usage }, null, 2)}\n`,
  );
  return `fixture missing: ${recordedReplyPath(callSite, hash)}; run pnpm --filter @meet-first/llm write-fixture ${callSite} ${requestPath} ${responsePath}`;
}

// Checks one fixture file: it exists, it holds this request and this reply, and it is hand-written.
// Returns true when every check passed.
function checkFixture(callSite: CallSite, request: LlmRequest, reply: FixtureReply): boolean {
  const hash = requestHash(request.body);
  if (!existsSync(recordedReplyPath(callSite, hash)))
    throw new Error(missing(callSite, request, reply));
  const call = loadRecordedReply(callSite, hash);
  expect(call.request).toEqual(request);
  expect(call.handWritten).toBe(true);
  expect(call.recordedAt).toBeNull();
  expect(call.response).toEqual(reply.response);
  expect(call.usage).toEqual(reply.usage);
  return true;
}

describe("the hand-written fixtures", () => {
  it("R13.3-T3: every names case has a hand-written fixture whose request equals the request the job builds", () => {
    for (const fixtureCase of NAMES_FIXTURE_CASES) {
      for (const [index, call] of namesCaseCalls(fixtureCase).entries()) {
        expect(
          checkFixture("scrub_names", fixtureRequest(call), {
            response: replyResponse(fixtureCase.replies[index]),
            usage: fixtureCase.usage,
          }),
        ).toBe(true);
      }
    }
  });

  it("R13.3-T4: every card case has a hand-written fixture for each of its calls", () => {
    for (const fixtureCase of CARD_FIXTURE_CASES) {
      const calls = cardCaseCalls(fixtureCase);
      calls.forEach((call, index) => {
        const reply = index === 0 ? fixtureCase.firstReply : fixtureCase.regenerationReply;
        expect(
          checkFixture("card", fixtureRequest(call), {
            response: replyResponse(reply),
            usage: fixtureCase.usage,
          }),
        ).toBe(true);
      });
    }
  });

  it("D21-T6: every card case's first reply parses as CardBuildOutput except the invalid case", () => {
    for (const fixtureCase of CARD_FIXTURE_CASES) {
      expect(CardBuildOutput.safeParse(fixtureCase.firstReply).success).toBe(
        fixtureCase.isReplyValid,
      );
    }
  });

  it("R13.3-T5: the golden path names rule gives Rohan Mehta for A and the marked names for B", () => {
    const a = fixtureRequest(
      namesPassCall({
        allowlist: ["A"],
        chunkText: "[t:0] Lunch with Rohan Mehta, then my friend Arjun Rao called.",
      }),
    );
    const b = fixtureRequest(
      namesPassCall({
        allowlist: ["B"],
        chunkText: "[t:0] My friend Arjun Rao and my manager Lee sent notes about Tom.",
      }),
    );
    const replyA = goldenPathReply(a);
    const replyB = goldenPathReply(b);
    expect(replyA.ok && replyB.ok).toBe(true);
    if (!replyA.ok || !replyB.ok) return;
    expect(replyA.response).toEqual(
      replyResponse({ names: [{ text: "Rohan Mehta", role: "colleague" }] }),
    );
    expect(replyA.usage).toEqual({
      promptTokens: Math.ceil(requestChars(a.body) / 4),
      cachedTokens: 0,
      completionTokens: 20,
      reasoningTokens: 0,
    });
    expect(replyB.response).toEqual(
      replyResponse({
        names: [
          { text: "Arjun Rao", role: "friend" },
          { text: "Lee", role: "manager" },
        ],
      }),
    );
  });

  it("R13.3-T6: the golden path card rule quotes the start of each first line, every item verifies, and under 6 turns it refuses", () => {
    const turns = cardCaseTurns(cardCase("card-ready"));
    const reply = goldenPathReply(fixtureRequest(cardCall(turns)));
    const short = goldenPathReply(fixtureRequest(cardCall(turns.slice(0, 5))));
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const content =
      (reply.response as { choices: Array<{ message: { content: string } }> }).choices[0]?.message
        .content ?? "{}";
    const parsed = CardBuildOutput.parse(JSON.parse(content));
    expect(parsed.items.map((item) => item.kind)).toEqual([...GOLDEN_PATH_KINDS]);
    expect(parsed.items.map((item) => item.turn_id)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(parsed.items[0]?.quote).toBe(
      "I ask for written feedback because I forget half of what people say in meetings",
    );
    expect(parsed.items[2]?.quote).toBe(
      "I do not answer work messages after nine at night, even when my team is in",
    );
    const checks = verifyItems(parsed.items, new Map(turns.map((turn) => [turn.turnIndex, turn])), [
      cardCall(turns).messages[0]?.content ?? "",
    ]);
    expect(checks).toHaveLength(8);
    expect(checks.every((check) => check.ok)).toBe(true);
    expect(short).toEqual({ ok: false, reason: "only 5 turns give a quote; a ready card needs 6" });
  });
});
