// One person's profile from Explore, at /people/:listingId (wave 7).
export { PersonScreen } from "./screen.js";
// The profile header, the About and Posts tabs and the coming-soon card, which /me reuses for your own profile.
export { ProfileHeader, ProfileTabs, PostsSoonCard } from "./profile-parts.js";
// The count words and the coming-soon words, which /me and the tests reuse.
export { thingsSharedWords, postsSoonCopy } from "./people-state.js";
// The profile reader with its friend request actions, which /me reuses for your own listing.
export { useProfile } from "./people-state.js";
