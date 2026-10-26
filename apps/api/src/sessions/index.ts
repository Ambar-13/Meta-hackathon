// The sessions folder: who a request acts for, and the five routes that make, recover, move and end a session (A5, A7, D33, D69).
import type { RoutePlugin } from "../app-types.js";
import { registerClaim } from "./claim.js";
import { registerCreatePerson } from "./create-person.js";
import { registerDeletePerson } from "./delete-person.js";
import { registerRecover } from "./recover.js";
import { registerTransfer } from "./transfer.js";

// The sessions routes as one plugin for server.ts slot 1, in this order: create person, recover, transfer, claim, delete me (seams S2).
export const registerSessionsRoutes: RoutePlugin = (app, deps) => {
  registerCreatePerson(app, deps);
  registerRecover(app, deps);
  registerTransfer(app, deps);
  registerClaim(app, deps);
  registerDeletePerson(app, deps);
  return Promise.resolve();
};

// The session hook, the person check, and the cookie and token functions that server.ts and the pairs folder use (A7, D33).
export { addSessionHook, clearSessionCookie, hashToken, isPublicRoute, newHexToken, PUBLIC_ROUTES, requirePerson, setSessionCookie } from "./cookie.js";
// The Origin check and the allowed-origin reader (A7).
export { addOriginCheck, appOrigin } from "./origin-check.js";
// The account limit for POST /api/people (R9.5).
export { registerAccountRateLimit } from "./rate-limit.js";
