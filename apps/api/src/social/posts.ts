// Posts as Explore and a profile show them (migration 0009): the newest posts of people listed in Explore, and one listed person's
// posts for their profile's Posts tab. Both read through definer functions that never return a person id.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { EXPLORE_POSTS_MAX, PostsView, PROFILE_POSTS_MAX, routes, Uuid } from "@meet-first/contracts";
import { withPerson } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";

// The :id of GET /api/directory/:id/posts: a listing id. One that is not a uuid is not_found, so a bad id tells nothing.
const ListingParams = z.object({ id: Uuid });

// One row of explore_posts or listing_posts by its SQL names (migration 0009).
type PostRow = { post_id: string; listing_id: string; display_name: string; is_sample: boolean; text: string; created_at: Date };

// The posts view of some post rows, in their order.
export function toPostsView(rows: readonly PostRow[]): PostsView {
  return PostsView.parse({ posts: rows.map((row) => ({ postId: row.post_id, listingId: row.listing_id, displayName: row.display_name, isSample: row.is_sample, text: row.text, createdAt: row.created_at.toISOString() })) });
}

// Registers GET /api/posts: 200 PostsView, the newest EXPLORE_POSTS_MAX posts of people listed in Explore, leaving out the caller's own.
export function registerListPosts(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listPosts.path, async (request, reply) => {
    const personId = requirePerson(request);
    const rows = await withPerson(deps.db, personId, async (trx) => (await sql<PostRow>`SELECT post_id, listing_id, display_name, is_sample, text, created_at FROM explore_posts(${EXPLORE_POSTS_MAX}::int)`.execute(trx)).rows);
    reply.header("cache-control", "no-store");
    return reply.code(200).send(toPostsView(rows));
  });
}

// Registers GET /api/directory/:id/posts: 200 PostsView, the newest PROFILE_POSTS_MAX posts of one listed person, empty for a listing
// Explore does not show; 404 not_found for a bad id.
export function registerListListingPosts(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listListingPosts.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = ListingParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const rows = await withPerson(deps.db, personId, async (trx) => (await sql<PostRow>`SELECT post_id, listing_id, display_name, is_sample, text, created_at FROM listing_posts(${params.data.id}::uuid, ${PROFILE_POSTS_MAX}::int)`.execute(trx)).rows);
    reply.header("cache-control", "no-store");
    return reply.code(200).send(toPostsView(rows));
  });
}
