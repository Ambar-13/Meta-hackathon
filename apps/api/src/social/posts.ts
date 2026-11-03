// Posts as Explore and a profile show them (migration 0009): the newest posts of people listed in Explore, and one listed person's
// posts for their profile's Posts tab. Both read through definer functions that never return a person id.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { EXPLORE_POSTS_MAX, PostsView, PROFILE_POSTS_MAX, routes, Uuid } from "@meet-first/contracts";
import { samplePostPhoto, withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { personPhoto, readListingPhotos, type PhotoIds } from "../home/person-photos.js";

// The :id of GET /api/directory/:id/posts: a listing id. One that is not a uuid is not_found, so a bad id tells nothing.
const ListingParams = z.object({ id: Uuid });

// One row of explore_posts or listing_posts by its SQL names (migration 0009).
type PostRow = { post_id: string; listing_id: string; display_name: string; is_sample: boolean; text: string; created_at: Date };

// The posts view of some post rows, in their order; photos holds the photo ids of the writers who put up a photo, by listing.
export function toPostsView(rows: readonly PostRow[], photos: PhotoIds = new Map()): PostsView {
  return PostsView.parse({ posts: rows.map((row) => toPost(row, photos.get(row.listing_id))) });
}

// Reads post rows with a query and the photos of their writers, in one transaction.
async function readPosts(trx: DatabaseTransaction, rows: readonly PostRow[]): Promise<{ rows: readonly PostRow[]; photos: PhotoIds }> {
  return { rows, photos: await readListingPhotos(trx, [...new Set(rows.map((row) => row.listing_id))]) };
}

// One post row as the contract has it: the writer's picture (a sample person's face, or the photo a real person put up), and the post's
// photo when a sample person wrote it (3 Nov 2026).
function toPost(row: PostRow, writerPhotoId: string | undefined): PostsView["posts"][number] {
  const photo = row.is_sample ? samplePostPhoto(row.display_name, row.text) : null;
  return {
    postId: row.post_id,
    listingId: row.listing_id,
    displayName: row.display_name,
    isSample: row.is_sample,
    text: row.text,
    createdAt: row.created_at.toISOString(),
    authorPhoto: personPhoto({ isSample: row.is_sample, displayName: row.display_name, photoId: writerPhotoId }),
    photo: photo?.key ?? null,
    photoAlt: photo?.alt ?? null,
  };
}

// Registers GET /api/posts: 200 PostsView, the newest EXPLORE_POSTS_MAX posts of people listed in Explore, leaving out the caller's own.
export function registerListPosts(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listPosts.path, async (request, reply) => {
    const personId = requirePerson(request);
    const read = await withPerson(deps.db, personId, async (trx) => readPosts(trx, (await sql<PostRow>`SELECT post_id, listing_id, display_name, is_sample, text, created_at FROM explore_posts(${EXPLORE_POSTS_MAX}::int)`.execute(trx)).rows));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(toPostsView(read.rows, read.photos));
  });
}

// Registers GET /api/directory/:id/posts: 200 PostsView, the newest PROFILE_POSTS_MAX posts of one listed person, empty for a listing
// Explore does not show; 404 not_found for a bad id.
export function registerListListingPosts(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listListingPosts.path, async (request, reply) => {
    const personId = requirePerson(request);
    const params = ListingParams.safeParse(request.params);
    if (!params.success) throw makeNotFoundError();
    const read = await withPerson(deps.db, personId, async (trx) => readPosts(trx, (await sql<PostRow>`SELECT post_id, listing_id, display_name, is_sample, text, created_at FROM listing_posts(${params.data.id}::uuid, ${PROFILE_POSTS_MAX}::int)`.execute(trx)).rows));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(toPostsView(read.rows, read.photos));
  });
}
