// What exists: the web app and the api share one origin, so the browser sends the session cookie
// with every request to it, including a request that a page on another site makes it send. The
// problem: SameSite=Lax stops most of those, not all, and a POST that carries the cookie can change
// rows. The step: because a browser always sets the Origin header on POST, PUT, PATCH and DELETE,
// each such request must carry exactly our origin or it is refused with origin_mismatch, before the
// session is looked up. What it does not do: it does not check GET or HEAD, which change nothing
// but presence timestamps. (Technical name: an Origin check as the defence against cross-site
// request forgery.)
import type { FastifyInstance } from "fastify";
import { makeOriginMismatchError } from "../route-errors.js";

// The methods that need no Origin, because they read and change nothing but last_seen_at (OPTIONS
// is refused without our Origin, because nothing here answers it).
export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

// APP_ORIGIN reduced to scheme, host and port, so a trailing slash in the env value still matches the browser's
// Origin header. Example: "https://meet.example/" gives "https://meet.example".
export function appOrigin(appOriginValue: string): string {
  return new URL(appOriginValue).origin;
}

// True when a request may pass: a safe method, or an Origin header exactly equal to the allowed origin.
// In words: a POST from our own page passes; a POST with no Origin, or from http://evil.example, does not.
export function isOriginAllowed(
  method: string,
  originHeader: string | undefined,
  allowedOrigin: string,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return true;
  }
  return originHeader === allowedOrigin;
}

// Adds the Origin check as an onRequest hook; buildApp adds it before the session hook.
export function addOriginCheck(app: FastifyInstance, appOriginValue: string): void {
  const allowedOrigin = appOrigin(appOriginValue);
  app.addHook("onRequest", (request, reply, done) => {
    if (!isOriginAllowed(request.method, request.headers.origin, allowedOrigin)) {
      done(makeOriginMismatchError());
      return;
    }
    done();
  });
}
