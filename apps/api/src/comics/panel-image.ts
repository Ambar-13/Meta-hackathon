import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COMIC_PANELS, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";

// The params of GET /api/comics/:id/panels/:position: a comic id and a panel number from 1 to 6.
const PanelParams = z.object({ id: Uuid, position: z.coerce.number().int().min(1).max(COMIC_PANELS) });

// Registers GET /api/comics/:id/panels/:position: 200 with the webp bytes; 404 panel_not_found.
export function registerPanelImage(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(routes.briefs.panelImage.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = PanelParams.safeParse(request.params);
    if (!params.success) throw new ContractError("panel_not_found", "No panel exists at that place in this comic.", HTTP.notFound);
    const image = await withPerson(deps.db, personId, async (trx) => {
      const row = await trx.selectFrom("comic_panels").select("image").where("comic_id", "=", params.data.id).where("position", "=", params.data.position).executeTakeFirst();
      if (row === undefined) throw new ContractError("panel_not_found", "No panel exists at that place in this comic.", HTTP.notFound);
      return Buffer.from(row.image);
    });
    // A stored panel never changes; the row is deleted, not edited, so a member's browser may keep it for a day.
    return reply.header("Content-Type", "image/webp").header("Cache-Control", "private, max-age=86400").code(200).send(image);
  });
  return Promise.resolve();
}
