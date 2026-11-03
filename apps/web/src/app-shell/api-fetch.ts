import { ErrorBody, routes, SourceCreateResponse, type MyPhoto } from "@meet-first/contracts";
import { z } from "zod";
import { setServerOffsetOnce } from "./server-clock.js";

// The one route map the app calls, from contracts: routes.people, routes.sources, routes.cards, routes.meetings and routes.briefs.
export { routes };

// The base type of every route schema, as parseReply and apiFetch read it.
export type AnySchema = z.ZodType<unknown, z.ZodTypeDef, unknown>;
// The shape of every contracts route entry: method, a path with :id, :slug or :position parts, and the two schemas.
export type ApiRoute = { method: string; path: string; request: AnySchema; response: AnySchema };

// A failed call: the HTTP status (0 when no reply arrived), a stable code, the sentence a screen shows, and the reply body.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(details: { status: number; code: string; message: string; body?: unknown }) {
    super(details.message);
    this.name = "ApiError";
    this.status = details.status;
    this.code = details.code;
    this.body = details.body;
  }
}

// What one call needs besides its route: path values, query values, a JSON body, a reply schema used instead of the route's, and test inputs.
export type ApiFetchOptions<S extends AnySchema = AnySchema> = {
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string | number>>;
  body?: unknown;
  replySchema?: S;
  fetchImpl?: typeof fetch;
  origin?: string;
  signal?: AbortSignal;
};

// The sentence for each error code the browser makes itself, and for each status with no server sentence.
const CODE_SENTENCES: Readonly<Record<string, string>> = {
  network_failed: "The server could not be reached. Check your connection and try again.",
  request_cancelled: "The request was stopped.",
  request_invalid: "This screen built a request the server would refuse. Reload the page and try again.",
  path_value_missing: "This link is missing a part. Go back and open it again.",
  response_unreadable: "The server sent a reply this screen cannot read. Reload the page and try again.",
  response_invalid: "The server reply did not have the expected shape. Reload the page and try again.",
  http_401: "Sign in again from the start page.",
  http_403: "Open the app from its own address and try again.",
  http_404: "This no longer exists or is not yours.",
  http_413: "This upload is too large. Pick a smaller file or paste fewer notes.",
  http_429: "Too many tries for now. Wait a few minutes and try again.",
};

// The sentence a network failure shows; polled-view.ts reuses it.
export const NETWORK_FAILED_SENTENCE = CODE_SENTENCES.network_failed ?? "";

// The sentence for one error code the browser makes itself.
function sentenceFor(code: string): string {
  return CODE_SENTENCES[code] ?? "The server could not finish this. Try again in a minute.";
}

// The code and sentence for a status with no server sentence.
function fallbackFor(status: number): { code: string; message: string } {
  const code = `http_${String(status)}`;
  return { code, message: sentenceFor(code) };
}

// The error for a reply that is not 2xx: the server's ErrorBody when it sent one, else the fallback for the status.
function errorFor(status: number, json: unknown): ApiError {
  const found = ErrorBody.safeParse(json);
  if (found.success) return new ApiError({ status, code: found.data.code, message: found.data.message, body: json });
  const fallback = fallbackFor(status);
  return new ApiError({ status, code: fallback.code, message: fallback.message, body: json });
}

// The origin the app is on, or a local one when no page exists (unit tests run in Node).
function pageOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

// Fills the :name parts of a contracts path and adds the query, so no file writes an /api path by hand.
export function buildApiPath(path: string, params: Readonly<Record<string, string>>, query: Readonly<Record<string, string | number>>): string {
  const filled = path
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const value = params[segment.slice(1)];
      if (value === undefined) throw new ApiError({ status: 0, code: "path_value_missing", message: sentenceFor("path_value_missing") });
      return encodeURIComponent(value);
    })
    .join("/");
  const entries = Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]);
  return entries.length === 0 ? filled : `${filled}?${new URLSearchParams(entries).toString()}`;
}

// Turns a thrown error from fetch into the error a screen shows.
function networkError(thrown: unknown): ApiError {
  const isCancelled = thrown instanceof Error && thrown.name === "AbortError";
  const code = isCancelled ? "request_cancelled" : "network_failed";
  return new ApiError({ status: 0, code, message: sentenceFor(code) });
}

// Reads a reply body as JSON; a 2xx body that is not JSON is an unreadable reply.
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (response.ok) throw new ApiError({ status: response.status, code: "response_unreadable", message: sentenceFor("response_unreadable") });
    return undefined;
  }
}

// Reads a reply that is not 2xx into an ApiError: the server's ErrorBody when it sent one, else the fallback for the status.
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text();
  let json: unknown = undefined;
  if (text !== "") {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = undefined;
    }
  }
  return errorFor(response.status, json);
}

// Checks a 2xx reply against its schema and remembers the server clock from it.
function parseReply<S extends AnySchema>(schema: S, json: unknown, status: number): S["_output"] {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError({ status, code: "response_invalid", message: sentenceFor("response_invalid"), body: json });
  const data: unknown = parsed.data;
  if (typeof data === "object" && data !== null && "serverNow" in data && typeof data.serverNow === "string") {
    setServerOffsetOnce(data.serverNow, Date.now());
  }
  return parsed.data;
}

// Builds the request settings for one call; a body is checked against the route's request schema before any fetch.
function requestFor(route: ApiRoute, options: ApiFetchOptions): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method: route.method, credentials: "same-origin", cache: "no-store", headers };
  if (options.signal !== undefined) init.signal = options.signal;
  if (options.body === undefined) return init;
  const checked = route.request.safeParse(options.body);
  if (!checked.success) throw new ApiError({ status: 0, code: "request_invalid", message: sentenceFor("request_invalid") });
  init.body = JSON.stringify(checked.data);
  headers["Content-Type"] = "application/json";
  return init;
}

// Sends one request and returns the reply, or throws the ApiError for it.
async function send(url: URL, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (thrown: unknown) {
    throw networkError(thrown);
  }
}

// Calls one route on this origin and returns its parsed reply; throws ApiError for every failure.
export async function apiFetch<R extends ApiRoute, S extends AnySchema = R["response"]>(route: R, options: ApiFetchOptions<S> = {}): Promise<S["_output"]> {
  const url = new URL(buildApiPath(route.path, options.params ?? {}, options.query ?? {}), options.origin ?? pageOrigin());
  const response = await send(url, requestFor(route, options), options.fetchImpl ?? fetch);
  const json = await readJson(response);
  if (!response.ok) throw errorFor(response.status, json);
  const schema = (options.replySchema ?? route.response) as S;
  return parseReply(schema, json, response.status);
}

// Posts the prepared NDJSON body to POST /api/sources with its content headers, and parses the reply.
export async function apiUpload(upload: { body: Blob; contentEncoding: "gzip" | null }, options: Pick<ApiFetchOptions, "fetchImpl" | "origin"> = {}): Promise<SourceCreateResponse> {
  const url = new URL(routes.sources.createSource.path, options.origin ?? pageOrigin());
  const headers: Record<string, string> = { "Content-Type": "application/x-ndjson", Accept: "application/json" };
  if (upload.contentEncoding === "gzip") headers["Content-Encoding"] = "gzip";
  const init: RequestInit = { method: "POST", credentials: "same-origin", cache: "no-store", headers, body: upload.body };
  const response = await send(url, init, options.fetchImpl ?? fetch);
  const json = await readJson(response);
  if (!response.ok) throw errorFor(response.status, json);
  return parseReply(routes.sources.createSource.response, json, response.status);
}

// Puts up a profile photo with PUT /api/people/me/photo: the JPEG bytes the browser drew, sent as image/jpeg.
export async function apiPhotoUpload(photo: Blob, options: Pick<ApiFetchOptions, "fetchImpl" | "origin"> = {}): Promise<MyPhoto> {
  const url = new URL(routes.people.uploadPhoto.path, options.origin ?? pageOrigin());
  const init: RequestInit = { method: "PUT", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "image/jpeg", Accept: "application/json" }, body: photo };
  const response = await send(url, init, options.fetchImpl ?? fetch);
  const json = await readJson(response);
  if (!response.ok) throw errorFor(response.status, json);
  return parseReply(routes.people.uploadPhoto.response, json, response.status);
}

// Makes sure a thrown value is an ApiError, so a screen always shows a sentence.
export function asApiError(thrown: unknown): ApiError {
  if (thrown instanceof ApiError) return thrown;
  return networkError(thrown);
}
