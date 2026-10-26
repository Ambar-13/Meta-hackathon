// The web-pages folder: the built web app, the app-shell fallback for client paths, the CSP header, and /api/health (A7, D67, R12.5).
import type { FastifyInstance } from "fastify";
import type { RouteDeps, RoutePlugin } from "../app-types.js";
import { DISK_PLAN_BYTES, registerHealthRoute } from "./health.js";
import { registerSpaFallback } from "./spa-fallback.js";
import { registerStaticFiles, WEB_DIST_DIR } from "./static-files.js";

// Where the web build is and how big the disk is; the real values are WEB_DIST_DIR and DISK_PLAN_BYTES, and tests pass their own.
export type WebPagesOptions = { distDir: string; diskPlanBytes: number };

// Registers health, the hashed files, then the fallback, in that order, with the options given (A7, R12.5).
export async function registerWebPages(app: FastifyInstance, deps: RouteDeps, options: WebPagesOptions): Promise<void> {
  registerHealthRoute(app, deps, options.diskPlanBytes);
  const hasBuild = await registerStaticFiles(app, options.distDir);
  await registerSpaFallback(app, options.distDir, hasBuild);
}

// The web pages as one plugin for server.ts slot 11, always last, because its fallback answers every GET path no route above claimed (seams S2).
export const registerWebPagesRoutes: RoutePlugin = (app, deps) => registerWebPages(app, deps, { distDir: WEB_DIST_DIR, diskPlanBytes: DISK_PLAN_BYTES });

// The policy header, which server.ts adds before any route (D67).
export { addContentSecurityPolicy, CONTENT_SECURITY_POLICY } from "./static-files.js";
