// One reply the gallery gives for a stubbed route: a status, a JSON body (a string is sent as an
// event stream), and an optional wait.
export type GalleryReply = { status: number; body: unknown; delayMs?: number };
// One route the gallery answers, with its replies in order; the last reply repeats, like stubRoute
// in the accessibility tests.
export type GalleryStub = {
  route: { method: string; path: string };
  replies: GalleryReply | GalleryReply[];
};
// A wait long enough that a screen stays in its loading state for the whole screenshot.
export const FOREVER_MS = 1_000_000_000;

// One stub, ready to match: the method, the path as a pattern, the replies and how many have been
// served.
type StubEntry = { method: string; pattern: RegExp; replies: GalleryReply[]; served: number };

// A path like /api/cards/:id as a pattern that matches any one segment where a :name stands.
function patternOf(path: string): RegExp {
  return new RegExp(`^${path.replace(/:[A-Za-z]+/g, "[^/]+")}$`);
}

// The URL and method of a fetch call, whatever form its input took.
function readCall(
  input: RequestInfo | URL,
  init?: RequestInit,
): { pathname: string; method: string } {
  let href = typeof input === "string" ? input : "";
  if (input instanceof URL) href = input.href;
  if (input instanceof Request) href = input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return { pathname: new URL(href, window.location.href).pathname, method: method.toUpperCase() };
}

// The Response for one reply: empty, an event stream for a string body, or JSON.
function responseOf(reply: GalleryReply): Response {
  if (reply.body === undefined || reply.body === null)
    return new Response(null, { status: reply.status });
  if (typeof reply.body === "string")
    return new Response(reply.body, {
      status: reply.status,
      headers: { "Content-Type": "text/event-stream" },
    });
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
}

// Replaces window.fetch with a table of stubbed routes; a route with no stub answers a plain 404,
// so a screen shows its error state with the words a person would see in the app.
export function installFetchStub(stubs: readonly GalleryStub[]): void {
  const table: StubEntry[] = stubs.map((stub) => ({
    method: stub.route.method,
    pattern: patternOf(stub.route.path),
    replies: Array.isArray(stub.replies) ? stub.replies : [stub.replies],
    served: 0,
  }));
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call = readCall(input, init);
    const entry = table.find(
      (row) => row.method === call.method && row.pattern.test(call.pathname),
    );
    const reply = entry?.replies[Math.min(entry.served, entry.replies.length - 1)];
    if (entry === undefined || reply === undefined) {
      return responseOf({
        status: 404,
        body: { code: "not_found", message: "We could not find this. It may have been deleted." },
      });
    }
    entry.served += 1;
    if (reply.delayMs !== undefined)
      await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    return responseOf(reply);
  };
}
