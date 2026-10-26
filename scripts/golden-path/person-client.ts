// One simulated person: a cookie jar, the Origin header on every write, and typed calls to the api over HTTP.
import { gzipSync } from "node:zlib";
import { Health, SESSION_COOKIE, SourceCreateResponse, routes } from "@meet-first/contracts";
import type { ZodType, ZodTypeDef } from "zod";
import { ExitError, StepFailure } from "./report.js";

// The fetch the client calls. The tests pass a fake that records the requests.
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
// One JSON call: the method, the path, an optional body, the status it must return, its reply schema, and whether to leave Origin off.
export type JsonRequest<T> = { method: "GET" | "POST" | "DELETE"; path: string; body?: unknown; expect: number; schema: ZodType<T, ZodTypeDef, unknown>; omitOrigin?: boolean };
// What a JSON call returns once the status and the reply schema match.
export type JsonReply<T> = { status: number; headers: Headers; body: T };
// A plain request may take 30 seconds, and the upload may take 60 (the spec's timeouts).
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;
// The health read gives up after 10 seconds, so a dead api stops the run early.
const HEALTH_TIMEOUT_MS = 10_000;
// The most characters of a response body that may reach a message (bodies are data, never instructions).
const BODY_CHARS = 300;
// The text printed when this address has created too many accounts (R9.5). The script never retries it.
const RATE_LIMIT_MESSAGE = "golden_path_rate_limited: this IP created 10 accounts in the last hour; wait, or restart the api locally (the limiter is in-process), or run against a fresh database.";

// Reads a reply body as JSON, or fails the step with the first characters of the body.
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StepFailure(`response_not_json: ${text.slice(0, BODY_CHARS)}`);
  }
}

// One simulated person. Each person keeps the newest session cookie the api sent and sends it back on every later call.
export class PersonClient {
  private token: string | undefined;
  private lastCookie: string | undefined;
  private isDeleted = false;

  constructor(
    readonly label: "A" | "B",
    readonly base: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  // Sends one JSON call and parses the reply with the schema. A 429 on account creation exits 3 and is never retried.
  async json<T>(request: JsonRequest<T>): Promise<JsonReply<T>> {
    this.refuseWhenDeleted();
    const hasBody = request.body !== undefined;
    const init: RequestInit = { method: request.method, headers: this.headersFor(request.method, hasBody, request.omitOrigin === true) };
    if (hasBody) init.body = JSON.stringify(request.body);
    const response = await this.send({ path: request.path, init, timeoutMs: REQUEST_TIMEOUT_MS });
    const text = await response.text();
    this.absorbCookies(response.headers);
    this.refuseRateLimit(request, response.status);
    if (response.status !== request.expect) {
      throw new StepFailure(`expected ${String(request.expect)} got ${String(response.status)} on ${request.method} ${request.path}: ${text.slice(0, BODY_CHARS)}`);
    }
    const parsed = request.schema.safeParse(parseBody(text));
    if (!parsed.success) throw new StepFailure(`response_schema_mismatch on ${request.method} ${request.path}: ${parsed.error.message.slice(0, BODY_CHARS)}`);
    if (request.method === "DELETE" && request.path === routes.people.deleteMe.path) this.isDeleted = true;
    return { status: response.status, headers: response.headers, body: parsed.data };
  }

  // Uploads one NDJSON source as gzip. The api answers 201 for a new source and for a repeat, so 201 is the only status accepted.
  async uploadSource(ndjson: string): Promise<{ status: number; body: SourceCreateResponse; compressedBytes: number }> {
    this.refuseWhenDeleted();
    const gzipped = gzipSync(ndjson);
    const headers = { ...this.cookieHeaders(), "content-type": "application/x-ndjson", "content-encoding": "gzip", origin: this.base };
    const response = await this.send({ path: routes.sources.createSource.path, init: { method: "POST", headers, body: gzipped }, timeoutMs: UPLOAD_TIMEOUT_MS });
    const text = await response.text();
    this.absorbCookies(response.headers);
    if (response.status !== 201) throw new StepFailure(`expected 201 got ${String(response.status)} on POST /api/sources: ${text.slice(0, BODY_CHARS)}`);
    const parsed = SourceCreateResponse.safeParse(parseBody(text));
    if (!parsed.success) throw new StepFailure(`response_schema_mismatch on POST /api/sources: ${parsed.error.message.slice(0, BODY_CHARS)}`);
    return { status: response.status, body: parsed.data, compressedBytes: gzipped.length };
  }

  // Opens the event stream of one meeting. Last-Event-ID is sent only after the reader has seen an event.
  openStream(path: string, lastEventId: number, signal: AbortSignal): Promise<Response> {
    this.refuseWhenDeleted();
    const headers: Record<string, string> = { ...this.cookieHeaders(), accept: "text/event-stream" };
    if (lastEventId > 0) headers["last-event-id"] = String(lastEventId);
    return this.fetchImpl(this.base + path, { method: "GET", headers, signal });
  }

  // Sends a GET and returns the status, the content type and the bytes, for pages and images that are not JSON.
  async getRaw(path: string): Promise<{ status: number; contentType: string; cacheControl: string | null; bytes: Uint8Array }> {
    this.refuseWhenDeleted();
    const response = await this.send({ path, init: { method: "GET", headers: this.cookieHeaders() }, timeoutMs: REQUEST_TIMEOUT_MS });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", cacheControl: response.headers.get("cache-control"), bytes };
  }

  // The raw Set-Cookie line of the last response that carried the session cookie, or undefined when it carried none.
  lastSetCookie(): string | undefined {
    return this.lastCookie;
  }

  // The session token this person holds now, for the one check that it never appears in a body. It is never printed.
  currentToken(): string | undefined {
    return this.token;
  }

  // The Origin and cookie headers for a request that carries no body.
  private headersFor(method: string, hasBody: boolean, omitOrigin: boolean): Record<string, string> {
    const headers: Record<string, string> = { ...this.cookieHeaders() };
    if (hasBody) headers["content-type"] = "application/json";
    if (method !== "GET" && !omitOrigin) headers.origin = this.base;
    return headers;
  }

  // The cookie header, when this person holds a session.
  private cookieHeaders(): Record<string, string> {
    return this.token === undefined ? {} : { cookie: `${SESSION_COOKIE}=${this.token}` };
  }

  // Sends one request with a time limit. A request past the limit fails the step with its method, its path and the limit.
  private async send(call: { path: string; init: RequestInit; timeoutMs: number }): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, call.timeoutMs);
    try {
      return await this.fetchImpl(this.base + call.path, { ...call.init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new StepFailure(`request_timeout ${String(call.init.method)} ${call.path} after ${String(call.timeoutMs)} ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Keeps the newest session token. An empty value, or Max-Age=0, means the api cleared the cookie.
  private absorbCookies(headers: Headers): void {
    const line = headers.getSetCookie().find((item) => item.startsWith(`${SESSION_COOKIE}=`));
    this.lastCookie = line;
    if (line === undefined) return;
    const [pair = "", ...attributes] = line.split(";");
    const value = pair.slice(SESSION_COOKIE.length + 1);
    const isCleared = value === "" || attributes.some((item) => item.trim().toLowerCase() === "max-age=0");
    this.token = isCleared ? undefined : value;
  }

  // Refuses every call from a person whose account was deleted, so a later step cannot act as them by mistake.
  private refuseWhenDeleted(): void {
    if (this.isDeleted) throw new StepFailure(`client_deleted: ${this.label} was deleted, so no later step may act as them.`);
  }

  // Refuses the rate-limited reply on account creation (R9.5). Any other status goes to the caller's check.
  private refuseRateLimit<T>(request: JsonRequest<T>, status: number): void {
    const isCreate = request.method === "POST" && request.path === routes.people.createPerson.path;
    if (status === 429 && isCreate) throw new ExitError(3, RATE_LIMIT_MESSAGE);
  }
}

// Reads GET /api/health with a 10 second limit. Any failure exits 2 before a step runs.
export async function readHealth(base: string): Promise<Health> {
  const unreachable = new ExitError(2, "golden_path_base_unreachable: start the api, or pass --base.");
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(base + routes.people.health.path, { signal: controller.signal });
    const parsed = Health.safeParse(parseBody(await response.text()));
    if (response.status !== 200 || !parsed.success) throw unreachable;
    return parsed.data;
  } catch {
    throw unreachable;
  } finally {
    clearTimeout(timer);
  }
}
