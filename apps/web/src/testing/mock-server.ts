import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { delay, http, HttpResponse } from "msw";
import { ContractError } from "@meet-first/contracts";

// One reply the MSW server gives for a stubbed route (seams S11).
export type StubReply = { status: number; body: unknown; delayMs?: number };
// What a test may pass to stubRoute: a full reply, or a body that is answered with status 200.
export type StubInput = StubReply | object;

// Reads one stubRoute argument: a { status, body } reply as it is, or any other value as a 200 reply with that body.
function asStubReply(input: StubInput): StubReply {
  if ("status" in input && "body" in input && typeof input.status === "number") return { ...input, status: input.status, body: input.body };
  return { status: 200, body: input };
}

// One MSW server for every accessibility test, shared by all its files.
const server = setupServer();
// The requests recorded per "METHOD path", in order.
const recorded = new Map<string, Array<{ url: string; body: unknown }>>();

// Reads a request body as JSON, as text when it is not JSON, or null when it is empty.
async function readBody(request: Request): Promise<unknown> {
  const text = await request.clone().text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Answers one contracts route from the MSW server; with a list, the replies are served in order and the last one repeats (seams S11).
export function stubRoute(route: { method: string; path: string }, replies: StubInput | StubInput[]): void {
  const list: StubReply[] = (Array.isArray(replies) ? replies : [replies]).map(asStubReply);
  if (list.length === 0) throw new ContractError("stub_replies_empty", "Give stubRoute at least one reply.");
  const key = `${route.method} ${route.path}`;
  const method = { GET: http.get, POST: http.post, PUT: http.put, DELETE: http.delete }[route.method];
  if (method === undefined) throw new ContractError("stub_method_unknown", "Stub only GET, POST, PUT or DELETE routes.");
  let served = 0;
  server.use(
    method(new URL(route.path, window.location.origin).href, async ({ request }) => {
      const log = recorded.get(key) ?? [];
      log.push({ url: request.url, body: await readBody(request) });
      recorded.set(key, log);
      const reply = list[Math.min(served, list.length - 1)] ?? list[0];
      served += 1;
      if (reply === undefined) throw new ContractError("stub_replies_empty", "Give stubRoute at least one reply.");
      if (reply.delayMs !== undefined) await delay(reply.delayMs);
      if (reply.body === undefined || reply.body === null) return new HttpResponse(null, { status: reply.status });
      if (typeof reply.body === "string") {
        return new HttpResponse(reply.body, { status: reply.status, headers: { "Content-Type": "text/event-stream" } });
      }
      return HttpResponse.json(reply.body, { status: reply.status });
    }),
  );
}

// Every request the MSW server received for one route, in order, so a test can count them (seams S11).
export function requestsTo(route: { method: string; path: string }): Array<{ url: string; body: unknown }> {
  return [...(recorded.get(`${route.method} ${route.path}`) ?? [])];
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  recorded.clear();
  vi.useRealTimers();
});

afterAll(() => {
  server.close();
});
