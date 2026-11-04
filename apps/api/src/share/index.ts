import type { RoutePlugin } from "../app-types.js";
import { registerGiveConsent } from "./give-consent.js";
import { registerReadSharePage } from "./read-share-page.js";
import { registerWithdrawConsent } from "./withdraw-consent.js";

// The share routes as one plugin for apps/api/src/server.ts slot 10: give consent, withdraw
// consent, read the public page.
export const registerShareRoutes: RoutePlugin = async (app, deps) => {
  await registerGiveConsent(app, deps);
  await registerWithdrawConsent(app, deps);
  await registerReadSharePage(app, deps);
};

// Builds the public snapshot inside the meeting context and checks it before it is stored.
export { buildShareSnapshot } from "./snapshot.js";
// Refuses a value that holds a key the public page must never carry.
export { assertNoForbiddenKeys } from "./snapshot.js";
// Says whether one brief line may be shared.
export { isShareableLine } from "./snapshot.js";
// Makes a new random slug for a share page.
export { makeSlug } from "./snapshot.js";
