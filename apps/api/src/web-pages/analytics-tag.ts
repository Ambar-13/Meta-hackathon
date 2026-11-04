import type { FastifyInstance } from "fastify";

// Google Analytics' tag for Meety's one property, as Google serves it.
export const TAG_SOURCE_URL = "https://www.googletagmanager.com/gtag/js?id=G-0DLJPMZJV4";
// Where the app loads the tag from, as TAG_URL in apps/web/src/app-shell/analytics.ts.
export const TAG_PATH = "/gtag.js";
// How long one copy of the tag is kept before a request fetches a fresh one: an hour.
export const TAG_KEEP_MS = 3_600_000;
// How long a fetch from Google may take before the last copy is used instead.
const TAG_FETCH_TIMEOUT_MS = 5_000;
const JAVASCRIPT_CONTENT_TYPE = "text/javascript; charset=utf-8";
// A browser keeps the tag for as long as the server does, because it is nearly half a megabyte.
const TAG_CACHE = "public, max-age=3600";

// Fetches the tag from Google; throws when Google does not answer with it.
export async function fetchTagFromGoogle(): Promise<string> {
  const response = await fetch(TAG_SOURCE_URL, {
    signal: AbortSignal.timeout(TAG_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`gtag_fetch_failed: Google answered ${String(response.status)}`);
  }
  return await response.text();
}

// What exists: Google Analytics runs from a script that Google serves. The problem: allowing
// Google's script host in the Content-Security-Policy would also allow any other tag or Tag Manager
// container from that host, because a policy cannot tell one id in a query from another. The step:
// the server fetches the tag for Meety's one id and serves it from this site, so the policy keeps
// scripts to our own origin; a query on this path changes nothing. What it does not do: it does not
// keep a copy on disk, so the first request after a restart waits for Google, and with no copy and
// no answer from Google the page runs without analytics.
export function registerAnalyticsTag(
  app: FastifyInstance,
  fetchTag: () => Promise<string>,
  now: () => number,
): void {
  let copy: { body: string; fetchedAt: number } | null = null;
  app.get(TAG_PATH, async (request, reply) => {
    if (copy === null || now() - copy.fetchedAt >= TAG_KEEP_MS) {
      try {
        copy = { body: await fetchTag(), fetchedAt: now() };
      } catch (error) {
        request.log.warn({ code: "analytics_tag_unavailable", error }, "analytics_tag_unavailable");
      }
    }
    if (copy === null) {
      return reply.code(503).send();
    }
    return reply
      .header("content-type", JAVASCRIPT_CONTENT_TYPE)
      .header("cache-control", TAG_CACHE)
      .send(copy.body);
  });
}
