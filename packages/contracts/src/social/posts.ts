import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";

// The most posts GET /api/posts returns for Explore, newest first.
export const EXPLORE_POSTS_MAX = 30;
// The most posts one profile's Posts tab shows, newest first.
export const PROFILE_POSTS_MAX = 50;

// One post as Explore and a profile show it: the text, when it went up, and its author by their listing, display name and sample
// mark, never a person id (migration 0009).
export const Post = z.object({ postId: Uuid, listingId: Uuid, displayName: z.string(), isSample: z.boolean(), text: z.string(), createdAt: IsoTime });
// The type of Post, read from the schema above.
export type Post = z.infer<typeof Post>;

// What GET /api/posts and GET /api/directory/:id/posts return: posts, newest first.
export const PostsView = z.object({ posts: z.array(Post) });
// The type of PostsView, read from the schema above.
export type PostsView = z.infer<typeof PostsView>;
