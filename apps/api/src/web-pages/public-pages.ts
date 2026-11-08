import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { PUBLIC_PAGES } from "@meet-first/contracts";
import { HTML_CONTENT_TYPE, INDEX_CACHE, ORIGIN_PLACEHOLDER } from "./spa-fallback.js";

// The folder under the web build where apps/web/prerender.ts wrote the public pages.
export const PRERENDERED_DIR = "prerendered";
// The files at the site's root that browsers and link previews ask for by name, each served from
// the web build when it is there, with its type.
export const ROOT_FILES: ReadonlyArray<{ path: string; file: string; type: string }> = [
  { path: "/favicon.svg", file: "favicon.svg", type: "image/svg+xml" },
  { path: "/apple-touch-icon.png", file: "apple-touch-icon.png", type: "image/png" },
  { path: "/og.png", file: "og.png", type: "image/png" },
];
// The cache header of a root file: one day, because its name never changes.
export const ROOT_FILE_CACHE = "public, max-age=86400";
// The crawlers that feed searches and answers, each named in robots.txt, so that a later edit to
// the group for every other crawler can never block them by accident. Blocking any of these removes
// the site from that engine's results; training-only crawlers are not named and follow the * group.
export const ANSWER_BOTS: readonly string[] = [
  "Googlebot",
  "Bingbot",
  "Applebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "Meta-WebIndexer",
];

// APP_ORIGIN reduced to scheme, host and port, so a trailing slash in the env value never reaches a
// canonical link or the sitemap.
export function originOf(appOrigin: string): string {
  return new URL(appOrigin).origin;
}

// robots.txt for one origin: every crawler may read every page but the api, in two groups that say
// the same thing, and the sitemap is named.
export function robotsText(origin: string): string {
  const rules = ["Disallow: /api/", "Allow: /"];
  const answerGroup = [...ANSWER_BOTS.map((bot) => `User-agent: ${bot}`), ...rules];
  const everyoneGroup = ["User-agent: *", ...rules];
  return [...answerGroup, "", ...everyoneGroup, "", `Sitemap: ${origin}/sitemap.xml`, ""].join(
    "\n",
  );
}

// sitemap.xml for one origin: the public pages, each with the day its words last changed.
export function sitemapXml(origin: string): string {
  const urls = PUBLIC_PAGES.map(
    (page) =>
      `  <url>\n    <loc>${origin}${page.path}</loc>\n    <lastmod>${page.changed}</lastmod>\n  </url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

// One file of the web build as bytes, or null when the build has no such file.
async function readBuildFile(distDir: string, ...parts: string[]): Promise<Buffer | null> {
  try {
    return await readFile(join(distDir, ...parts));
  } catch {
    return null;
  }
}

// Registers each root file the build has, at its path, with its type and the one-day cache.
async function registerRootFiles(app: FastifyInstance, distDir: string): Promise<void> {
  for (const rootFile of ROOT_FILES) {
    const bytes = await readBuildFile(distDir, rootFile.file);
    if (bytes === null) continue;
    app.get(rootFile.path, (request, reply) =>
      reply.header("cache-control", ROOT_FILE_CACHE).type(rootFile.type).send(bytes),
    );
  }
}

// Registers each public page the build has, at its exact path, with the origin in place of the
// placeholder; a page the build lacks falls through to the app shell.
async function registerPrerenderedPages(
  app: FastifyInstance,
  distDir: string,
  origin: string,
): Promise<void> {
  for (const page of PUBLIC_PAGES) {
    const bytes = await readBuildFile(distDir, PRERENDERED_DIR, page.file);
    if (bytes === null) continue;
    const html = bytes.toString("utf8").replaceAll(ORIGIN_PLACEHOLDER, origin);
    app.get(page.path, (request, reply) =>
      reply.header("cache-control", INDEX_CACHE).type(HTML_CONTENT_TYPE).send(html),
    );
  }
}

// Registers robots.txt and sitemap.xml for the api's origin, then the root files and the
// prerendered public pages the build has; registered before the app-shell fallback, whose /* would
// otherwise answer every one of these paths with the empty shell.
export async function registerPublicPages(
  app: FastifyInstance,
  distDir: string,
  appOrigin: string,
): Promise<void> {
  const origin = originOf(appOrigin);
  const robots = robotsText(origin);
  const sitemap = sitemapXml(origin);
  app.get("/robots.txt", (request, reply) =>
    reply.header("cache-control", ROOT_FILE_CACHE).type("text/plain; charset=utf-8").send(robots),
  );
  app.get("/sitemap.xml", (request, reply) =>
    reply
      .header("cache-control", ROOT_FILE_CACHE)
      .type("application/xml; charset=utf-8")
      .send(sitemap),
  );
  await registerRootFiles(app, distDir);
  await registerPrerenderedPages(app, distDir, origin);
}
