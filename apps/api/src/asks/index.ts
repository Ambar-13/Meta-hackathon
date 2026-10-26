// The ask routes as one plugin for apps/api/src/server.ts slot 12 (as-built item 49): create an ask, read one, list asks and the
// caller's copies, and meet a helper from a help answer. Filled by asks-api-web.
import type { RoutePlugin } from "../app-types.js";

// Registers nothing until the asks-api-web builder lands its routes here.
export const registerAsksRoutes: RoutePlugin = async () => {
  await Promise.resolve();
};
