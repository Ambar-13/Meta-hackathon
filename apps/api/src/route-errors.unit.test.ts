import type { FastifyReply, FastifyRequest } from "fastify";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { ContractError } from "@meet-first/contracts";
import { describeError, handleRouteError, parseJsonBody } from "./route-errors.js";

const PAYLOAD_INVALID_SENTENCE =
  "The request body did not match the expected shape. Reload and try again.";
const INTERNAL_SENTENCE = "Something went wrong on our side. Try again in a minute.";

type FakeReply = { status: (code: number) => FakeReply; send: (body: unknown) => FakeReply };

// A reply that records the status and body it was given, so a test can read them back.
function fakeReply(statuses: number[], bodies: unknown[]): FastifyReply {
  const reply: FakeReply = {
    status: (code) => {
      statuses.push(code);
      return reply;
    },
    send: (body) => {
      bodies.push(body);
      return reply;
    },
  };
  return reply as unknown as FastifyReply;
}

it("D4-T2: parseJsonBody turns an empty body into no body and refuses broken JSON with payload_invalid", async () => {
  const request = {} as FastifyRequest;

  const emptyBody = await parseJsonBody(request, "");
  const blankBody = await parseJsonBody(request, "   ");
  const objectBody = await parseJsonBody(request, '{"displayName":"A"}');
  const brokenBody = parseJsonBody(request, "{");

  expect(emptyBody).toBeUndefined();
  expect(blankBody).toBeUndefined();
  expect(objectBody).toEqual({ displayName: "A" });
  await expect(brokenBody).rejects.toBeInstanceOf(ContractError);
  await expect(brokenBody).rejects.toMatchObject({ code: "payload_invalid", httpStatus: 400 });
});

it("D4-T3: describeError maps each thrown kind to one status, code and sentence", () => {
  const zodFailure = z.object({ a: z.string() }).safeParse({});
  if (zodFailure.success) {
    throw new Error("the empty object should fail the schema");
  }

  expect(describeError(new ContractError("pair_unavailable", "x", 409))).toEqual({
    status: 409,
    code: "pair_unavailable",
    message: "x",
  });
  expect(describeError(zodFailure.error)).toEqual({
    status: 400,
    code: "payload_invalid",
    message: PAYLOAD_INVALID_SENTENCE,
  });
  expect(describeError({ statusCode: 413 })).toEqual({
    status: 413,
    code: "payload_too_large",
    message: "The request body is over the size limit for this route. Send a smaller body.",
  });
  expect(describeError({ statusCode: 415 })).toEqual({
    status: 415,
    code: "content_type_unsupported",
    message: "Send the body as JSON with Content-Type application/json.",
  });
  expect(describeError({ statusCode: 429, code: "too_many_accounts", message: "m" })).toEqual({
    status: 429,
    code: "too_many_accounts",
    message: "m",
  });
  expect(describeError({ statusCode: 429 })).toEqual({
    status: 429,
    code: "request_refused",
    message: "The request was refused. Reload and try again.",
  });
  expect(describeError({ statusCode: 404 })).toEqual({
    status: 404,
    code: "not_found",
    message: "This no longer exists or is not yours.",
  });
  expect(describeError({ statusCode: 418 })).toEqual({
    status: 418,
    code: "request_refused",
    message: "The request was refused. Reload and try again.",
  });
  expect(describeError(new Error("boom"))).toEqual({
    status: 500,
    code: "internal_error",
    message: INTERNAL_SENTENCE,
  });
  expect(describeError("text")).toEqual({
    status: 500,
    code: "internal_error",
    message: INTERNAL_SENTENCE,
  });
});

it("D4-T4: handleRouteError sends ErrorBody with the status and logs only internal errors (uses a fake reply and a fake logger)", () => {
  const firstStatuses: number[] = [];
  const firstBodies: unknown[] = [];
  const secondStatuses: number[] = [];
  const secondBodies: unknown[] = [];
  const spy = vi.fn();
  const request = { log: { error: spy } } as unknown as FastifyRequest;

  handleRouteError(
    new ContractError("origin_mismatch", "Open the app from its own address and try again.", 403),
    request,
    fakeReply(firstStatuses, firstBodies),
  );
  const callsAfterFirst = spy.mock.calls.length;
  handleRouteError(new Error("boom"), request, fakeReply(secondStatuses, secondBodies));

  expect(firstStatuses).toEqual([403]);
  expect(firstBodies).toEqual([
    { code: "origin_mismatch", message: "Open the app from its own address and try again." },
  ]);
  expect(callsAfterFirst).toBe(0);
  expect(secondStatuses).toEqual([500]);
  expect(secondBodies).toEqual([expect.objectContaining({ code: "internal_error" })]);
  expect(spy).toHaveBeenCalledTimes(1);
});
