// The web-pages folder: the built web app, the app-shell fallback for client paths, the CSP header,
// and /api/health.
import type { FastifyInstance } from "fastify";
import type { RouteDeps, RoutePlugin } from "../app-types.js";
import { fetchTagFromGoogle, registerAnalyticsTag } from "./analytics-tag.js";
import { registerHealthRoute } from "./health.js";
import { registerSpaFallback } from "./spa-fallback.js";
import { registerStaticFiles, WEB_DIST_DIR } from "./static-files.js";

// Where the web build is and how big the database's disk is; the real values are WEB_DIST_DIR and
// the env's DATABASE_DISK_BYTES, and tests pass their own.
export type WebPagesOptions = { distDir: string; diskPlanBytes: number };

// Registers health, Google Analytics' tag, the hashed files, then the fallback, in that order, with
// the options given.
export async function registerWebPages(
  app: FastifyInstance,
  deps: RouteDeps,
  options: WebPagesOptions,
): Promise<void> {
  registerHealthRoute(app, deps, options.diskPlanBytes);
  registerAnalyticsTag(app, fetchTagFromGoogle, Date.now);
  const hasBuild = await registerStaticFiles(app, options.distDir);
  await registerSpaFallback(app, options.distDir, hasBuild);
}

// The web pages as one plugin for server.ts slot 11, always last, because its fallback answers
// every GET path no route above claimed.
export const registerWebPagesRoutes: RoutePlugin = (app, deps) =>
  registerWebPages(app, deps, {
    distDir: WEB_DIST_DIR,
    diskPlanBytes: deps.env.DATABASE_DISK_BYTES,
  });

// The policy header, which server.ts adds before any route.
export { addContentSecurityPolicy, CONTENT_SECURITY_POLICY } from "./static-files.js";

// The move from Render's own address to APP_ORIGIN, which server.ts adds before the Origin check.
export { addRenderAddressRedirect } from "./render-address.js";
