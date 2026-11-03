// Sharing as Instagram does (3 Nov 2026, Ambar: "can people share story and post also? like insta? their agent can learn from those as
// well about what they like and what they post"): anyone signed in shares a post or a story that shows for STORY_HOURS, with words, a
// photo or both, deletes their own, and likes the posts the feed and profiles show them. The browser draws each photo itself as a JPEG,
// which drops any camera or location data, and sends it as base64; the api checks the bytes are a JPEG of a sane size before storing
// them (migration 0013).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { ContractError, HTTP, POST_PHOTO_BASE64_MAX_CHARS, POST_PHOTO_MAX_BYTES, PostCreate, PostCreated, PostLiked, routes, SHARES_PER_DAY, STORY_HOURS, Uuid } from "@meet-first/contracts";
import { numberFromPostgres, withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { isJpeg } from "../home/profile-edit.js";
import { makeNotFoundError, makePayloadInvalidError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of the delete and like routes: a post id. One that is not a uuid is not_found, so a bad id tells nothing.
const PostParams = z.object({ id: Uuid });
// The body limit of POST /api/posts: the largest photo as base64, and room for the words and the JSON around them.
const CREATE_BODY_LIMIT_BYTES = POST_PHOTO_BASE64_MAX_CHARS + 8_192;

// The photo of a new post as bytes, or null when it has none; a photo that is not a JPEG, or is larger than POST_PHOTO_MAX_BYTES, is
// payload_invalid.
function photoBytes(photo: string | null): Buffer | null {
  if (photo === null) return null;
  const bytes = Buffer.from(photo, "base64");
  if (bytes.length > POST_PHOTO_MAX_BYTES || !isJpeg(bytes)) throw makePayloadInvalidError();
  return bytes;
}

// Registers POST /api/posts: 201 PostCreated with the new post's id, its kind and when a story stops showing; 400 payload_invalid for a
// body with neither words nor a photo, or a photo that is not a JPEG of at most POST_PHOTO_MAX_BYTES; 429 post_daily_cap once the caller
// has shared SHARES_PER_DAY times this UTC day.
export function registerCreatePost(app: FastifyInstance, deps: RouteDeps): void {
  app.post(routes.social.createPost.path, { bodyLimit: CREATE_BODY_LIMIT_BYTES }, async (request, reply) => {
    const personId = requirePerson(request);
    const body = PostCreate.safeParse(request.body);
    if (!body.success) throw makePayloadInvalidError();
    const photo = photoBytes(body.data.photo);
    const row = await withPerson(deps.db, personId, async (trx) => {
      const today = await trx.selectFrom("posts").select(sql<string>`count(*)`.as("n"))
        .where("person_id", "=", personId).where("created_at", ">=", sql<Date>`date_trunc('day', now(), 'UTC')`).executeTakeFirstOrThrow();
      if (numberFromPostgres(today.n) >= SHARES_PER_DAY) throw new ContractError("post_daily_cap", "You have shared a lot today. Try again tomorrow.", HTTP.tooMany);
      const expiresAt = body.data.kind === "story" ? sql<Date>`now() + make_interval(hours => ${STORY_HOURS})` : null;
      return trx.insertInto("posts").values({ person_id: personId, kind: body.data.kind, text: body.data.text, photo, expires_at: expiresAt })
        .returning(["id", "kind", "expires_at"]).executeTakeFirstOrThrow();
    });
    return reply.code(201).send(PostCreated.parse({ postId: row.id, kind: row.kind, expiresAt: row.expires_at?.toISOString() ?? null }));
  });
}

// Registers DELETE /api/posts/:id: 204 once the caller's own post or story is gone, with its likes; 404 not_found for an id that is not
// one of theirs, or not an id at all.
export function registerDeletePost(app: FastifyInstance, deps: RouteDeps): void {
  app.delete(routes.social.deletePost.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = PostParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const result = await withPerson(deps.db, personId, (trx) => trx.deleteFrom("posts").where("id", "=", params.data.id).where("person_id", "=", personId).executeTakeFirst());
    if (result.numDeletedRows === 0n) throw makeNotFoundError();
    return reply.code(204).send();
  });
}

// The handler of one like route: PUT likes a post the feed or a profile shows the caller (liking twice changes nothing), and 404s for any
// other post; DELETE takes the caller's like away, also when there was none or the post is gone.
function likeHandler(deps: RouteDeps, isLiked: boolean) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const personId = requirePerson(request);
    const params = PostParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const postId = params.data.id;
    await withPerson(deps.db, personId, async (trx) => {
      if (!isLiked) {
        await trx.deleteFrom("post_likes").where("post_id", "=", postId).where("person_id", "=", personId).execute();
        return;
      }
      const isVisible = (await sql<{ visible: boolean }>`SELECT post_is_visible(${postId}::uuid) AS visible`.execute(trx)).rows[0]?.visible === true;
      if (!isVisible) throw makeNotFoundError();
      await trx.insertInto("post_likes").values({ post_id: postId, person_id: personId }).onConflict((conflict) => conflict.doNothing()).execute();
    });
    return reply.code(200).send(PostLiked.parse({ postId, isLiked }));
  };
}

// Registers PUT and DELETE /api/posts/:id/like: 200 PostLiked with whether the caller likes the post now; 404 not_found for a like on a
// post the caller is not shown.
export function registerLikePost(app: FastifyInstance, deps: RouteDeps): void {
  app.put(routes.social.likePost.path, likeHandler(deps, true));
  app.delete(routes.social.unlikePost.path, likeHandler(deps, false));
}
