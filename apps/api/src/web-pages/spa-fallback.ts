import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ContractError, isClientPath, isIndexablePath, pathOf } from "@meet-first/contracts";
import { makeNotFoundError } from "../route-errors.js";

// The content type of the app shell, with its charset.
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
// The app shell is never cached, so a new deploy reaches every browser on its next load.
export const INDEX_CACHE = "no-store";
// The header value that keeps a page out of search results. The shell carries it on every page
// that shows nothing without a session, and never on a public page or a share page.
export const NOINDEX = "noindex";
// The sentence when the api runs without a web build; the shell routes then answer 503.
export const WEB_BUILD_MISSING_SENTENCE =
  "The web app is not built yet. Run pnpm --filter web build, then restart the api.";

// True for /api, /api/... and /api?..., the paths that must never get the app shell.
export function isApiPath(url: string): boolean {
  return url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");
}

// The address without its trailing slash, query and fragment kept, for the redirect that gives
// every page one address: /privacy/?x=1 becomes /privacy?x=1. The path always starts with one
// slash and holds no backslash, so a request for //evil.example/ or /\evil.example/ can never
// become a Location that a browser reads as another site.
export function withoutTrailingSlash(url: string): string {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  const rest = end === -1 ? "" : url.slice(end);
  const onSite = `/${path.replaceAll("\\", "/").replace(/^\/+/, "")}`;
  return `${onSite.length > 1 && onSite.endsWith("/") ? onSite.slice(0, -1) : onSite}${rest}`;
}

// True when a request path, as sent, ends in a slash it should not: anything but the root.
function hasTrailingSlash(url: string): boolean {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return path.length > 1 && path.endsWith("/");
}

// Registers GET / and GET /*: the app shell for every page of the app, with noindex on the pages
// that show nothing without a session; the shell with a 404 for an address the app has no page
// for, so a missing page never counts as a page; a permanent redirect off a trailing slash; and
// not_found as JSON for an /api path no route claimed.
export async function registerSpaFallback(
  app: FastifyInstance,
  distDir: string,
  hasBuild: boolean,
): Promise<void> {
  const indexHtml = hasBuild ? await readFile(join(distDir, "index.html"), "utf8") : null;
  const handler = (request: FastifyRequest, reply: FastifyReply) => {
    if (isApiPath(request.url)) {
      throw makeNotFoundError();
    }
    if (indexHtml === null) {
      throw new ContractError("web_build_missing", WEB_BUILD_MISSING_SENTENCE, 503);
    }
    if (hasTrailingSlash(request.url)) {
      return reply.redirect(withoutTrailingSlash(request.url), 301);
    }
    const pathname = pathOf(request.url);
    reply.header("cache-control", INDEX_CACHE).type(HTML_CONTENT_TYPE);
    if (!isIndexablePath(pathname)) reply.header("x-robots-tag", NOINDEX);
    return reply.code(isClientPath(pathname) ? 200 : 404).send(indexHtml);
  };
  // The start page is claimed by its prerendered file when the build has one (public-pages.ts), so
  // the fallback takes "/" only when nothing has.
  if (!app.hasRoute({ method: "GET", url: "/" })) app.get("/", handler);
  app.get("/*", handler);
}
