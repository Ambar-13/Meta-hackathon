import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ComicView, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";

// The :id of GET /api/meetings/:id/comic: a uuid, or no comic can exist for it.
const RouteParams = z.object({ id: Uuid });

// Registers GET /api/meetings/:id/comic: 200 ComicView with panels once ready; 404 comic_not_found (R11.2).
export function registerReadComic(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(routes.briefs.readComic.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = RouteParams.safeParse(request.params);
    if (!params.success) throw new ContractError("comic_not_found", "No comic has been requested for this meeting.", HTTP.notFound);
    const meetingId = params.data.id;
    const view = await withPerson(deps.db, personId, async (trx) => {
      const comic = await trx.selectFrom("comics").select(["id", "state"]).where("meeting_id", "=", meetingId).executeTakeFirst();
      if (comic === undefined) throw new ContractError("comic_not_found", "No comic has been requested for this meeting.", HTTP.notFound);
      const panels = comic.state === "ready" ? await trx.selectFrom("comic_panels").select(["position", "caption"]).where("comic_id", "=", comic.id).orderBy("position", "asc").execute() : [];
      return ComicView.parse({
        state: comic.state,
        panels: panels.map((panel) => ({ position: panel.position, caption: panel.caption, imageUrl: `/api/comics/${comic.id}/panels/${String(panel.position)}` })),
      });
    });
    return reply.header("Cache-Control", "no-store").code(200).send(view);
  });
  return Promise.resolve();
}
