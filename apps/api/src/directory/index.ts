// The directory routes as one plugin for apps/api/src/server.ts slot 11 (as-built item 49): card sharing settings, browsing and
// joining the directory, the listed person's meetings, meetings with a listed persona, and the friends list. Filled by directory-api.
import type { RoutePlugin } from "../app-types.js";

// Registers nothing until the directory-api builder lands its routes here.
export const registerDirectoryRoutes: RoutePlugin = async () => {
  await Promise.resolve();
};
