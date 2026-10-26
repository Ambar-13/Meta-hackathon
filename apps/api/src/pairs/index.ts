// The pairs folder: invites made and joined by a single-use token, and the lobby poll that also marks presence (D32, D53, D54, R9.3).
import type { RoutePlugin } from "../app-types.js";
import { registerCreatePair } from "./create-pair.js";
import { registerJoinPair } from "./join-pair.js";
import { registerReadLobby } from "./read-lobby.js";

// The pairs routes as one plugin for server.ts slot 5, in this order: create, join, read (seams S2).
export const registerPairsRoutes: RoutePlugin = (app, deps) => {
  registerCreatePair(app, deps);
  registerJoinPair(app, deps);
  registerReadLobby(app, deps);
  return Promise.resolve();
};
