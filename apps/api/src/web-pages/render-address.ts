import type { FastifyInstance } from "fastify";

// The end of every address Render gives a service, such as meet-first.onrender.com.
export const RENDER_HOST_SUFFIX = ".onrender.com";
// The paths a redirect leaves alone: the api (Render's health check, and reads from a tab opened
// before the move) and the hashed build files (the chunks such a tab still loads).
const KEPT_PATH_PREFIXES = ["/api/", "/assets/"];

// The parts of a request a redirect reads: its method, its Host header and its path with the query.
export type AskedAddress = { method: string; host: string | undefined; url: string };

// Where a request should go instead, or null when this address answers it: a GET or HEAD for a page
// on a Render address goes to the same path and query on APP_ORIGIN, unless APP_ORIGIN is that
// address. Example: GET meet-first.onrender.com /people/1?tab=posts with APP_ORIGIN
// https://heymeety.com gives "https://heymeety.com/people/1?tab=posts".
export function appAddressFor(asked: AskedAddress, appOriginValue: string): string | null {
  const appUrl = new URL(appOriginValue);
  const hostname = asked.host?.toLowerCase().replace(/:\d+$/, "");
  if (asked.method !== "GET" && asked.method !== "HEAD") return null;
  if (hostname === undefined || !hostname.endsWith(RENDER_HOST_SUFFIX)) return null;
  if (hostname === appUrl.hostname) return null;
  if (KEPT_PATH_PREFIXES.some((prefix) => asked.url.startsWith(prefix))) return null;
  return appUrl.origin + asked.url;
}

// What exists: Render serves the app at its own address as well as at APP_ORIGIN, and links to
// that address are already out. The problem: a page opened there runs on another origin, so its
// POSTs fail the Origin check and its sign-in cookie is not the one APP_ORIGIN reads. The step: a
// page asked for on a Render address answers 301 with the same path and query on APP_ORIGIN, before
// the session is looked up. What it does not do: it does not move /api/ or /assets/, and it moves
// nothing while APP_ORIGIN is the Render address itself.
export function addRenderAddressRedirect(app: FastifyInstance, appOriginValue: string): void {
  app.addHook("onRequest", (request, reply, done) => {
    const asked = { method: request.method, host: request.headers.host, url: request.url };
    const target = appAddressFor(asked, appOriginValue);
    if (target === null) {
      done();
      return;
    }
    void reply.redirect(target, 301);
  });
}
