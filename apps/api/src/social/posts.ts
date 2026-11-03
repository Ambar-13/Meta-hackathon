// Posts as the feed and a profile show them (migration 0009): the newest posts of people listed in Explore, one listed person's posts for
// their profile's Posts tab, and, since 3 Nov 2026 (migration 0013), your own posts and the stories in the row of faces. Others' posts and
// stories read through definer functions that never return a person id; your own read through row security.
import type { FastifyInstance } from "fastify";
import { sql } from "kysely";
import { z } from "zod";
import { EXPLORE_POSTS_MAX, MyPostsView, PostsView, PROFILE_POSTS_MAX, routes, STORIES_MAX, StoriesView, Uuid, type Story } from "@meet-first/contracts";
import { sampleFaceKey, samplePostPhoto, withPerson, type DatabaseTransaction } from "@meet-first/db";
import type { RouteDeps } from "../app-types.js";
import { makeNotFoundError } from "../route-errors.js";
import { requirePerson } from "../sessions/index.js";
import { personPhoto, photoKeyOf, readListingPhotos, readOwnPhoto, type PhotoIds } from "../home/person-photos.js";

// The :id of GET /api/directory/:id/posts: a listing id. One that is not a uuid is not_found, so a bad id tells nothing.
const ListingParams = z.object({ id: Uuid });

// One row of explore_posts or listing_posts by its SQL names (migrations 0009 and 0013).
type PostRow = { post_id: string; listing_id: string; display_name: string; is_sample: boolean; text: string; created_at: Date; is_mine: boolean; is_liked: boolean; has_photo: boolean };
// The columns of PostRow, as both post functions return them.
const POST_COLUMNS = sql.raw("post_id, listing_id, display_name, is_sample, text, created_at, is_mine, is_liked, has_photo");
// One row of story_feed by its SQL names (migration 0013).
type StoryRow = { story_id: string; listing_id: string | null; display_name: string; is_sample: boolean; is_mine: boolean; text: string; has_photo: boolean; created_at: Date; expires_at: Date };

// The posts view of some post rows, in their order; photos holds the photo ids of the writers who put up a photo, by listing.
export function toPostsView(rows: readonly PostRow[], photos: PhotoIds = new Map()): PostsView {
  return PostsView.parse({ posts: rows.map((row) => toPost(row, photos.get(row.listing_id))) });
}

// The newest EXPLORE_POSTS_MAX posts of the feed, the caller's own among them once they are listed.
async function readExplorePosts(trx: DatabaseTransaction): Promise<PostRow[]> {
  return (await sql<PostRow>`SELECT ${POST_COLUMNS} FROM explore_posts(${EXPLORE_POSTS_MAX}::int)`.execute(trx)).rows;
}

// Reads post rows with a query and the photos of their writers, in one transaction.
async function readPosts(trx: DatabaseTransaction, rows: readonly PostRow[]): Promise<{ rows: readonly PostRow[]; photos: PhotoIds }> {
  return { rows, photos: await readListingPhotos(trx, [...new Set(rows.map((row) => row.listing_id))]) };
}

// The photo of a post and the words a screen reader reads for it: a sample person's bundled photo, else the photo the writer shared,
// read by the post's own id and described by its words, else none.
function postPhotoOf(row: { post_id: string; display_name: string; is_sample: boolean; text: string; has_photo: boolean }): { key: string; alt: string | null } | null {
  if (row.is_sample) return samplePostPhoto(row.display_name, row.text);
  return row.has_photo ? { key: photoKeyOf(row.post_id), alt: null } : null;
}

// One post row as the contract has it: the writer's picture (a sample person's face, or the photo a real person put up), the post's
// photo, and whether it is the caller's and the caller liked it (3 Nov 2026).
function toPost(row: PostRow, writerPhotoId: string | undefined): PostsView["posts"][number] {
  const photo = postPhotoOf(row);
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
    isMine: row.is_mine,
    isLiked: row.is_liked,
  };
}

// Registers GET /api/posts: 200 PostsView, the newest EXPLORE_POSTS_MAX posts of people listed in Explore, leaving out the caller's own.
export function registerListPosts(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listPosts.path, async (request, reply) => {
    const personId = requirePerson(request);
    const read = await withPerson(deps.db, personId, async (trx) => readPosts(trx, await readExplorePosts(trx)));
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
    const read = await withPerson(deps.db, personId, async (trx) => readPosts(trx, (await sql<PostRow>`SELECT ${POST_COLUMNS} FROM listing_posts(${params.data.id}::uuid, ${PROFILE_POSTS_MAX}::int)`.execute(trx)).rows));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(toPostsView(read.rows, read.photos));
  });
}

// Registers GET /api/people/me/posts: 200 MyPostsView, the caller's own posts, newest first, at most PROFILE_POSTS_MAX, whether or not
// they are in Explore, so the Posts tab of /me shows a post the moment it is shared.
export function registerListMyPosts(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listMyPosts.path, async (request, reply) => {
    const personId = requirePerson(request);
    const rows = await withPerson(deps.db, personId, (trx) =>
      trx.selectFrom("posts").select(["id", "text", "created_at", sql<boolean>`photo IS NOT NULL`.as("has_photo")])
        .where("person_id", "=", personId).where("kind", "=", "post").orderBy("created_at", "desc").orderBy("id").limit(PROFILE_POSTS_MAX).execute(),
    );
    reply.header("cache-control", "no-store");
    return reply.code(200).send(MyPostsView.parse({
      posts: rows.map((row) => ({ postId: row.id, text: row.text, createdAt: row.created_at.toISOString(), photo: row.has_photo ? photoKeyOf(row.id) : null, photoAlt: null })),
    }));
  });
}

// One story row as the contract has it, with its writer's picture.
function toStory(row: StoryRow, authorPhoto: string | null): Story {
  return {
    storyId: row.story_id, listingId: row.listing_id, displayName: row.display_name, isSample: row.is_sample, isMine: row.is_mine, authorPhoto,
    text: row.text, photo: row.has_photo ? photoKeyOf(row.story_id) : null, photoAlt: null, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
  };
}

// The stories of the sample people in the feed: each one's newest post with a photo, shown as their story with no end, because sample
// people share nothing themselves and the row of faces would be empty before real people share.
function sampleStories(rows: readonly PostRow[]): Story[] {
  const stories: Story[] = [];
  for (const row of rows) {
    const photo = row.is_sample ? samplePostPhoto(row.display_name, row.text) : null;
    if (photo === null || stories.some((story) => story.listingId === row.listing_id)) continue;
    stories.push({
      storyId: row.post_id, listingId: row.listing_id, displayName: row.display_name, isSample: true, isMine: false, authorPhoto: sampleFaceKey(row.display_name),
      text: row.text, photo: photo.key, photoAlt: photo.alt, createdAt: row.created_at.toISOString(), expiresAt: null,
    });
  }
  return stories;
}

// The stories in the row of faces: the caller's own first, then the others' newest first, each until it expires, then the sample people's.
async function readStories(trx: DatabaseTransaction, personId: string): Promise<Story[]> {
  const rows = (await sql<StoryRow>`SELECT story_id, listing_id, display_name, is_sample, is_mine, text, has_photo, created_at, expires_at FROM story_feed(${STORIES_MAX}::int)`.execute(trx)).rows;
  const photos = await readListingPhotos(trx, [...new Set(rows.flatMap((row) => (row.listing_id === null || row.is_mine ? [] : [row.listing_id])))]);
  const ownPhoto = rows.some((row) => row.is_mine) ? await readOwnPhoto(trx, personId) : null;
  const stories = rows.map((row) => toStory(row, row.is_mine ? ownPhoto : personPhoto({ isSample: row.is_sample, displayName: row.display_name, photoId: row.listing_id === null ? undefined : photos.get(row.listing_id) })));
  return [...stories, ...sampleStories(await readExplorePosts(trx))];
}

// Registers GET /api/stories: 200 StoriesView, the stories that show now, never cached because a story can expire at any moment.
export function registerListStories(app: FastifyInstance, deps: RouteDeps): void {
  app.get(routes.social.listStories.path, async (request, reply) => {
    const personId = requirePerson(request);
    const stories = await withPerson(deps.db, personId, (trx) => readStories(trx, personId));
    reply.header("cache-control", "no-store");
    return reply.code(200).send(StoriesView.parse({ stories }));
  });
}

