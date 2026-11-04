// One person's profile from Explore, at /people/:listingId.
export { PersonScreen } from "./screen.js";
// The profile header, the About and Posts tabs, the card of a Posts tab with no posts, and Delete
// on your own post, which /me and the feed reuse.
export { ProfileHeader, ProfileTabs, PostsEmptyCard, DeletePost } from "./profile-parts.js";
// The words of a Posts tab with no posts and a post's age in words, which /me, the feed and the
// tests reuse.
export { postsEmptyCopy, postAgeWords } from "./people-state.js";
// The profile reader with its friend request actions, which /me reuses for your own listing.
export { useProfile } from "./people-state.js";
