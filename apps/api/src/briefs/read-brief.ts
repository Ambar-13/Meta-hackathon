import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Brief, ContractError, HTTP, routes, Uuid } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { requirePerson } from "../sessions/index.js";
import { toBriefView } from "./brief-view.js";

// The params of the brief route: the meeting id, which must be a uuid.
const BriefParams = z.object({ id: Uuid });

// The answer for a brief that does not exist for this caller. A bad id, a meeting the caller is not in and a missing brief all get it, so ids cannot be probed.
function makeBriefNotFoundError(): ContractError {
  return new ContractError("brief_not_found", "This brief does not exist or is not yours.", HTTP.notFound);
}

// The answer while the brief is still being written. The screen asks again in a few seconds.
function makeBriefNotReadyError(): ContractError {
  return new ContractError("brief_not_ready", "The brief is not written yet. Ask again in a few seconds.", HTTP.notFound);
}

// Reads the caller's own brief of one meeting: missing membership is brief_not_found; a member with no row yet is brief_not_ready.
async function readOwnBrief(deps: RouteDeps, personId: string, meetingId: string): Promise<Brief> {
  return withPerson(deps.db, personId, async (trx) => {
    const member = await trx.selectFrom("meeting_members").select("person_id").where("meeting_id", "=", meetingId).where("person_id", "=", personId).executeTakeFirst();
    if (member === undefined) throw makeBriefNotFoundError();
    const row = await trx.selectFrom("briefs").select(["agree", "clash", "decide_first", "support_rate", "support_reliable"]).where("meeting_id", "=", meetingId).where("person_id", "=", personId).executeTakeFirst();
    if (row === undefined) throw makeBriefNotReadyError();
    const meeting = await trx.selectFrom("meetings").select("question_kind").where("id", "=", meetingId).executeTakeFirstOrThrow();
    return toBriefView(row, meeting.question_kind);
  });
}

// Registers GET /api/meetings/:id/brief: 200 Brief for the caller's own brief; 404 brief_not_ready or brief_not_found. Never cached.
export function registerReadBrief(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(routes.briefs.readBrief.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = BriefParams.safeParse(request.params);
    if (!params.success) throw makeBriefNotFoundError();
    const view = await readOwnBrief(deps, personId, params.data.id);
    reply.header("cache-control", "no-store");
    return reply.code(200).send(view);
  });
  return Promise.resolve();
}
