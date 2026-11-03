import { z } from "zod";
import { IsoTime, PhotoKey, Uuid } from "../primitives.js";

// The most posts GET /api/posts returns for Explore, newest first.
export const EXPLORE_POSTS_MAX = 30;
// The most posts one profile's Posts tab shows, newest first.
export const PROFILE_POSTS_MAX = 50;

// One post as the feed and a profile show it: the text, when it went up, and its author by their listing, display name and sample
// mark, never a person id (migration 0009); the author's picture, the post's photo and the words a screen reader reads for it
// (3 Nov 2026).
export const Post = z.object({
  postId: Uuid,
  listingId: Uuid,
  displayName: z.string(),
  isSample: z.boolean(),
  text: z.string(),
  createdAt: IsoTime,
  authorPhoto: PhotoKey.nullable().optional(),
  photo: PhotoKey.nullable().optional(),
  photoAlt: z.string().max(300).nullable().optional(),
  // Whether the caller wrote the post, and whether they liked it (migration 0013).
  isMine: z.boolean().optional(),
  isLiked: z.boolean().optional(),
});
// The type of Post, read from the schema above.
export type Post = z.infer<typeof Post>;

// What GET /api/posts and GET /api/directory/:id/posts return: posts, newest first.
export const PostsView = z.object({ posts: z.array(Post) });
// The type of PostsView, read from the schema above.
export type PostsView = z.infer<typeof PostsView>;

// The most characters a post's or a story's words may hold, as the posts table allows.
export const POST_TEXT_MAX_CHARS = 600;
// The largest photo a post or a story may carry, in bytes: a JPEG the browser drew at 1080 px, which stays well under this.
export const POST_PHOTO_MAX_BYTES = 1_000_000;
// The most base64 characters a photo of POST_PHOTO_MAX_BYTES takes.
export const POST_PHOTO_BASE64_MAX_CHARS = 4 * Math.ceil(POST_PHOTO_MAX_BYTES / 3);
// How long a story shows, in hours, as Instagram's.
export const STORY_HOURS = 24;
// The most posts and stories one person may share in a UTC day, so nobody fills the database with photos.
export const SHARES_PER_DAY = 30;
// The side in pixels of a post's square photo as the browser draws it, as Instagram's square post.
export const POST_PHOTO_SIDE = 1080;
// The most stories GET /api/stories returns, newest first after your own.
export const STORIES_MAX = 60;

// What one share is: a post for the feed and your profile, or a story for the row of faces for STORY_HOURS.
export const PostKind = z.enum(["post", "story"]);
// The type of PostKind, read from the schema above.
export type PostKind = z.infer<typeof PostKind>;

// The body of POST /api/posts: a post or a story, with words, a photo as base64 JPEG bytes, or both (3 Nov 2026, Ambar: "can people
// share story and post also? like insta?").
export const PostCreate = z.object({
  kind: PostKind,
  text: z.string().trim().max(POST_TEXT_MAX_CHARS),
  photo: z.string().max(POST_PHOTO_BASE64_MAX_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/).nullable(),
}).refine((body) => body.text !== "" || body.photo !== null, { message: "A post needs words or a photo." });
// The type of PostCreate, read from the schema above.
export type PostCreate = z.infer<typeof PostCreate>;

// What POST /api/posts returns: the new post's id, its kind, and when a story stops showing (null for a post).
export const PostCreated = z.object({ postId: Uuid, kind: PostKind, expiresAt: IsoTime.nullable() });
// The type of PostCreated, read from the schema above.
export type PostCreated = z.infer<typeof PostCreated>;

// What PUT and DELETE /api/posts/:id/like return: the post and whether the caller likes it now.
export const PostLiked = z.object({ postId: Uuid, isLiked: z.boolean() });
// The type of PostLiked, read from the schema above.
export type PostLiked = z.infer<typeof PostLiked>;

// One of your own posts, as your own Posts tab shows it whether or not you are in Explore: the words, when it went up and its photo.
export const MyPost = z.object({ postId: Uuid, text: z.string(), createdAt: IsoTime, photo: PhotoKey.nullable(), photoAlt: z.string().max(300).nullable() });
// The type of MyPost, read from the schema above.
export type MyPost = z.infer<typeof MyPost>;

// What GET /api/people/me/posts returns: your own posts, newest first.
export const MyPostsView = z.object({ posts: z.array(MyPost) });
// The type of MyPostsView, read from the schema above.
export type MyPostsView = z.infer<typeof MyPostsView>;

// One story in the row of faces: its writer by listing (null for your own while you are not in Explore), name, sample mark and
// picture, whether it is yours, its words and photo, when it went up, and when it stops showing (null for a sample person's, which is
// their newest photo post shown as a story).
export const Story = z.object({
  storyId: Uuid,
  listingId: Uuid.nullable(),
  displayName: z.string(),
  isSample: z.boolean(),
  isMine: z.boolean(),
  authorPhoto: PhotoKey.nullable(),
  text: z.string(),
  photo: PhotoKey.nullable(),
  photoAlt: z.string().max(300).nullable(),
  createdAt: IsoTime,
  expiresAt: IsoTime.nullable(),
});
// The type of Story, read from the schema above.
export type Story = z.infer<typeof Story>;

// What GET /api/stories returns: your own stories first, then the others newest first, then the sample people's.
export const StoriesView = z.object({ stories: z.array(Story) });
// The type of StoriesView, read from the schema above.
export type StoriesView = z.infer<typeof StoriesView>;
