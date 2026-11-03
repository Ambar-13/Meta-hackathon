import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { ContractError, ErrorBody, HTTP } from "@meet-first/contracts";

const PAYLOAD_INVALID_SENTENCE = "The request body did not match the expected shape. Reload and try again.";
const REQUEST_REFUSED_SENTENCE = "The request was refused. Reload and try again.";
const INTERNAL_SENTENCE = "Something went wrong on our side. Try again in a minute.";

// An error turned into the status, code and sentence the client receives.
export type DescribedError = { status: number; code: string; message: string };

// Status codes that Fastify or a plugin raises without a ContractError, each with the code and sentence the client sees (413 is the upload body limit).
export const FRAMEWORK_STATUS_ERRORS: Readonly<Record<number, { code: string; message: string }>> = {
  400: { code: "payload_invalid", message: PAYLOAD_INVALID_SENTENCE },
  404: { code: "not_found", message: "This no longer exists or is not yours." },
  413: { code: "payload_too_large", message: "The request body is over the size limit for this route. Send a smaller body." },
  415: { code: "content_type_unsupported", message: "Send the body as JSON with Content-Type application/json." },
};

// session_missing, 401. Contracts HTTP now names 401 as unauthorized, so the constant is read from there.
export function makeSessionMissingError(): ContractError {
  return new ContractError("session_missing", "Sign in again from the start page.", HTTP.unauthorized);
}

// origin_mismatch, 403.
export function makeOriginMismatchError(): ContractError {
  return new ContractError("origin_mismatch", "Open the app from its own address and try again.", HTTP.forbidden);
}

// not_found, 404. It is also the answer for an id that is not a uuid, so a bad id tells nothing.
export function makeNotFoundError(): ContractError {
  return new ContractError("not_found", "This no longer exists or is not yours.", HTTP.notFound);
}

// payload_invalid, 400.
export function makePayloadInvalidError(): ContractError {
  return new ContractError("payload_invalid", PAYLOAD_INVALID_SENTENCE, HTTP.badRequest);
}

// Reads one named field of a value, or undefined when the value is not an object or has no such field.
function readField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

// Reads a number field, or undefined when the field is not a number.
function readNumberField(value: unknown, key: string): number | undefined {
  const field = readField(value, key);
  return typeof field === "number" ? field : undefined;
}

// Reads a text field, or undefined when the field is not text.
function readTextField(value: unknown, key: string): string | undefined {
  const field = readField(value, key);
  return typeof field === "string" ? field : undefined;
}

// The answer for a status that Fastify or a plugin raised: the limiter's own code and sentence, a framework code, or
// request_refused for any other 4xx. Null for a status none of these rules cover.
function describeStatus(status: number, code: string | undefined, message: string | undefined): DescribedError | null {
  if (status === 429 && code !== undefined && message !== undefined) {
    return { status, code, message };
  }
  const known = FRAMEWORK_STATUS_ERRORS[status];
  if (known !== undefined) {
    return { status, ...known };
  }
  if (Number.isInteger(status) && status >= 400 && status <= 499) {
    return { status, code: "request_refused", message: REQUEST_REFUSED_SENTENCE };
  }
  return null;
}

// Decides the status for an error that Fastify or a plugin raised, by the rules after ContractError and ZodError.
function describeFastifyError(error: unknown): DescribedError {
  const status = readNumberField(error, "statusCode");
  const described = status === undefined ? null : describeStatus(status, readTextField(error, "code"), readTextField(error, "message"));
  return described ?? { status: 500, code: "internal_error", message: INTERNAL_SENTENCE };
}

// Decides the status, code and sentence for any thrown value, by the first rule that matches.
export function describeError(error: unknown): DescribedError {
  if (error instanceof ContractError) {
    return { status: error.httpStatus, code: error.code, message: error.message };
  }
  if (error instanceof ZodError) {
    return { status: 400, code: "payload_invalid", message: PAYLOAD_INVALID_SENTENCE };
  }
  return describeFastifyError(error);
}

// Reads a JSON body. An empty body counts as no body, because the web app and the golden-path script send
// Content-Type application/json on bodiless POSTs; broken JSON is payload_invalid.
export function parseJsonBody(request: FastifyRequest, body: string | Buffer): Promise<unknown> {
  const text = typeof body === "string" ? body : body.toString("utf8");
  if (text.trim() === "") {
    return Promise.resolve(undefined);
  }
  try {
    return Promise.resolve(JSON.parse(text) as unknown);
  } catch {
    return Promise.reject(makePayloadInvalidError());
  }
}

// Replaces Fastify's own JSON parser with parseJsonBody, because Fastify's refuses an empty body with its own error shape.
export function replaceJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, parseJsonBody);
}

// Sends ErrorBody for any thrown value, and logs the value at error level when it becomes internal_error (repo rule 3).
export function handleRouteError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const described = describeError(error);
  if (described.status === 500) {
    request.log.error({ err: error }, "internal_error");
  }
  void reply.status(described.status).send(ErrorBody.parse({ code: described.code, message: described.message }));
}

// Answers a path no route claimed with not_found as JSON; the web-pages GET fallback answers GET paths before this runs.
export function handleNotFound(request: FastifyRequest, reply: FastifyReply): void {
  const error = makeNotFoundError();
  void reply.status(error.httpStatus).send(ErrorBody.parse({ code: error.code, message: error.message }));
}
