import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ContractError } from "@meet-first/contracts";
import { makeNotFoundError } from "../route-errors.js";

// The content type of the app shell, with its charset.
export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
// The app shell is never cached, so a new deploy reaches every browser on its next load.
export const INDEX_CACHE = "no-store";
// The sentence when the api runs without a web build; the shell routes then answer 503.
export const WEB_BUILD_MISSING_SENTENCE =
  "The web app is not built yet. Run pnpm --filter web build, then restart the api.";

// True for /api, /api/... and /api?..., the paths that must never get the app shell.
export function isApiPath(url: string): boolean {
  return url === "/api" || url.startsWith("/api/") || url.startsWith("/api?");
}

// Registers GET / and GET /*: the app shell for every client path, not_found as JSON for an /api path no route claimed.
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
    return reply.header("cache-control", INDEX_CACHE).type(HTML_CONTENT_TYPE).send(indexHtml);
  };
  app.get("/", handler);
  app.get("/*", handler);
}
