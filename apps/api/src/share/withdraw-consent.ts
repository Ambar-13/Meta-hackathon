import type { FastifyInstance } from "fastify";
import { ConsentWithdrawResponse, routes } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";
import { meetingIdOfParams, sideOfMember } from "./give-consent.js";

// Withdraws the caller's consent, unpublishes the page and drops the stored snapshot. The row stays, so the slug stays reserved.
// A row that does not exist yet is the same as not published, so the answer is the same either way.
export async function withdrawConsent(trx: DatabaseTransaction, input: { meetingId: string; personId: string }): Promise<{ published: false }> {
  const side = await sideOfMember(trx, input.meetingId, input.personId);
  const cleared = side === "a" ? { consent_a: false, published: false, snapshot: null, published_at: null } : { consent_b: false, published: false, snapshot: null, published_at: null };
  await trx.updateTable("share_pages").set(cleared).where("meeting_id", "=", input.meetingId).execute();
  return { published: false };
}

// Registers DELETE /api/meetings/:id/consent: 200 {published: false}; 404 meeting_not_found.
export function registerWithdrawConsent(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.delete(routes.briefs.withdrawConsent.path, async (request, reply) => {
    const personId = requirePerson(request);
    const meetingId = meetingIdOfParams(request.params);
    const result = await withPerson(deps.db, personId, (trx) => withdrawConsent(trx, { meetingId, personId }));
    return reply.code(200).send(ConsentWithdrawResponse.parse(result));
  });
  return Promise.resolve();
}
