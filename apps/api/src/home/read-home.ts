import type { FastifyInstance } from "fastify";
import { routes } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";
import { readHomeView } from "./home-view.js";

// Registers GET /api/home: 200 HomeView for the signed-in person; 401 session_missing without a
// session.
export function registerReadHome(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.people.readHome.path, async (request, reply) => {
    const personId = requirePerson(request);
    const now = deps.now();
    const view = await withPerson(deps.db, personId, (trx) => readHomeView(trx, { personId, now }));
    return reply.code(200).send(view);
  });
}
