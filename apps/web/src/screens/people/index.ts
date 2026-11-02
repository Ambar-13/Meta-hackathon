// One person's profile from Explore, at /people/:listingId (wave 7).
export { PersonScreen } from "./screen.js";
// The profile header, the About and Posts tabs and the coming-soon card, which /me reuses for your own profile.
export { ProfileHeader, ProfileTabs, PostsSoonCard } from "./profile-parts.js";
// The count words, the coming-soon words and a post's age in words, which /me, Explore and the tests reuse.
export { thingsSharedWords, postsSoonCopy, postAgeWords } from "./people-state.js";
// The profile reader with its friend request actions, which /me reuses for your own listing.
export { useProfile } from "./people-state.js";
