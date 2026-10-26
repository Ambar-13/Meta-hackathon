import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

// Where the web build lives: apps/web/dist, beside this app in the repo and in the api image (A7: one origin serves both) [confirm] (Dockerfile.api, written by deploy-and-docs, must keep this relative path).
export const WEB_DIST_DIR = fileURLToPath(new URL("../../../web/dist/", import.meta.url));
// The cache header of a hashed build file: one year, never revalidated, because its name changes when its content does [confirm] (no input gives the value).
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
// The policy, exactly as D67 gives it after decision 9 removed API_ORIGIN (ARCHITECTURE.md 7.9).
export const CONTENT_SECURITY_POLICY = "default-src 'self'; img-src 'self' data:; connect-src 'self'";

// True when the folder holds a web build: an index.html and an assets folder (A7).
export function hasWebBuild(distDir: string): boolean {
  return existsSync(join(distDir, "index.html")) && existsSync(join(distDir, "assets"));
}

// Serves the hashed files of the web build under /assets/ with the one-year cache; returns whether a build was there (A7).
export async function registerStaticFiles(app: FastifyInstance, distDir: string): Promise<boolean> {
  if (!hasWebBuild(distDir)) {
    app.log.warn({ code: "web_build_missing", distDir }, "web_build_missing");
    return false;
  }
  await app.register(fastifyStatic, {
    root: join(distDir, "assets"),
    prefix: "/assets/",
    index: false,
    cacheControl: false,
    setHeaders: (response) => {
      response.setHeader("cache-control", IMMUTABLE_CACHE);
    },
  });
  return true;
}

// What exists: the browser runs our script and renders text the model wrote. The problem: if model text ever reached the page as HTML, an image tag could send card data to another site (R7.2). The step: every script, image and fetch we need comes from our own origin, so each response allows only our origin, plus data: images for the QR code and the shared comic panels (D67). What it does not do: it does not change model text, which apps/web renders through its allow-list (D66), and it is not on the meeting stream, whose headers events-route.ts writes itself.
// Adds the Content-Security-Policy header to every response that goes through Fastify's reply, JSON and HTML alike (D67) [confirm] (D67 names the header, not which responses carry it).
export function addContentSecurityPolicy(app: FastifyInstance): void {
  app.addHook("onSend", (request, reply, payload) => {
    reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
    return Promise.resolve(payload);
  });
}
