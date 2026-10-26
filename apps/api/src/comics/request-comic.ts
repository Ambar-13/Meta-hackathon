import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AVATARS, COMIC_PURGE_DAYS, ComicRequest, ComicRequestResponse, ContractError, HTTP, routes, Uuid, type Avatar } from "@meet-first/contracts";
import { withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The prompt version a new comic is drawn with; the worker reads the same version from packages/prompts (D64).
export const COMIC_PROMPT_VERSION = "v1";
// Milliseconds in one day, for the purge date of a new comic.
const DAY_MS = 86_400_000;
// The :id of POST /api/meetings/:id/comic: a uuid, or the meeting cannot exist.
const RouteParams = z.object({ id: Uuid });

// The avatar the other side gets: the next descriptor in AVATARS order, wrapping, so two people never share one (D64).
export function otherAvatarOf(avatar: Avatar): Avatar {
  const index = AVATARS.indexOf(avatar);
  return AVATARS[(index + 1) % AVATARS.length] ?? avatar;
}

// The two avatars of a new comic, by side: the requester's side keeps the chosen one.
export function avatarsBySide(side: "a" | "b", avatar: Avatar): { avatarA: Avatar; avatarB: Avatar } {
  const other = otherAvatarOf(avatar);
  return side === "a" ? { avatarA: avatar, avatarB: other } : { avatarA: other, avatarB: avatar };
}

// Inside one person's transaction: checks membership and the brief, then inserts the comic row, or returns the one that exists (R11.2, D64).
async function insertComicRequest(trx: DatabaseTransaction, input: { meetingId: string; personId: string; avatar: Avatar; now: Date }): Promise<{ comicId: string; isNew: boolean }> {
  const member = await trx.selectFrom("meeting_members").select(["side"]).where("meeting_id", "=", input.meetingId).where("person_id", "=", input.personId).executeTakeFirst();
  if (member === undefined) throw new ContractError("meeting_not_found", "This meeting does not exist or is not yours.", HTTP.notFound);
  const brief = await trx.selectFrom("meeting_events").select("seq").where("meeting_id", "=", input.meetingId).where("type", "=", "brief.ready").executeTakeFirst();
  if (brief === undefined) throw new ContractError("brief_not_ready", "The brief is not written yet. The comic comes after the brief.", HTTP.conflict);
  const existing = await trx.selectFrom("comics").select(["id"]).where("meeting_id", "=", input.meetingId).executeTakeFirst();
  if (existing !== undefined) return { comicId: existing.id, isNew: false };
  const avatars = avatarsBySide(member.side, input.avatar);
  const inserted = await trx
    .insertInto("comics")
    .values({
      meeting_id: input.meetingId,
      requested_by: input.personId,
      state: "rendering",
      avatar_a: avatars.avatarA,
      avatar_b: avatars.avatarB,
      prompt_version: COMIC_PROMPT_VERSION,
      purge_after: new Date(input.now.getTime() + COMIC_PURGE_DAYS * DAY_MS),
    })
    .onConflict((conflict) => conflict.column("meeting_id").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (inserted !== undefined) return { comicId: inserted.id, isNew: true };
  const raced = await trx.selectFrom("comics").select(["id"]).where("meeting_id", "=", input.meetingId).executeTakeFirstOrThrow();
  return { comicId: raced.id, isNew: false };
}

// Registers POST /api/meetings/:id/comic: 202 with the comic id; 404 meeting_not_found; 409 brief_not_ready; 400 comic_bad_avatar.
export function registerRequestComic(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(routes.briefs.requestComic.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = RouteParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const body = ComicRequest.safeParse(request.body);
    if (!body.success) throw new ContractError("comic_bad_avatar", "Pick one of the six avatars.", HTTP.badRequest);
    const meetingId = params.data.id;
    const outcome = await withPerson(deps.db, personId, (trx) => insertComicRequest(trx, { meetingId, personId, avatar: body.data.avatar, now: deps.now() }));
    if (outcome.isNew) {
      try {
        await deps.enqueue("render_comic", { comicId: outcome.comicId, meetingId });
      } catch (error) {
        await withPerson(deps.db, personId, (trx) => trx.deleteFrom("comics").where("id", "=", outcome.comicId).execute());
        throw error;
      }
    }
    return reply.code(202).send(ComicRequestResponse.parse({ comicId: outcome.comicId }));
  });
  return Promise.resolve();
}
