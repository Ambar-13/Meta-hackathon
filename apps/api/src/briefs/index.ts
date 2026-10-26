import type { RoutePlugin } from "../app-types.js";
import { registerReadBrief } from "./read-brief.js";

// The brief routes as one plugin for apps/api/src/server.ts slot 8 (seams S2): read the caller's own brief.
export const registerBriefsRoutes: RoutePlugin = async (app, deps) => {
  await registerReadBrief(app, deps);
};
// The brief row to contract mapping, shared with the share snapshot (ARCHITECTURE.md 3.19).
export { toBriefView, type BriefRow } from "./brief-view.js";
