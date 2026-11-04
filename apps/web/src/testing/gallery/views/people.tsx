import type { ReactElement } from "react";
import { PostsView, type ProfileView } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { PersonScreen } from "../../../screens/people/index.js";
import { IDS, profileView } from "../../fixtures.js";
import type { GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { railFriends, railRequests, railStubs, SAMPLE_LISTINGS, SAMPLE_POSTS } from "./explore.js";
import { AfterSteps } from "./help.js";

// The listing every profile view opens, and the pending request and pair of its friendship states.
const LISTING = "00000000-0000-4000-8000-000000000511";
const REQUEST = "00000000-0000-4000-8000-000000000531";
const PAIR = "00000000-0000-4000-8000-000000000141";

// The page's reads: this profile, these posts, and a rail with four friends and one request.
function reads(
  profile: ProfileView | { status: number; body: unknown },
  posts: PostsView,
): GalleryStub[] {
  const reply = "status" in profile ? profile : { status: 200, body: profile };
  return [
    ...railStubs(railFriends(4), railRequests(1)),
    { route: routes.social.readProfile, replies: reply },
    { route: routes.social.listListingPosts, replies: { status: 200, body: posts } },
  ];
}

// One view of the profile on its route, with no posts unless given; the card in the address lets a friend's profile offer Meet
// their agent, and search adds to the address.
function personView(
  head: { name: string; title: string },
  profile: ProfileView | { status: number; body: unknown },
  more: { element?: ReactElement; posts?: PostsView; search?: string } = {},
): GalleryView {
  return {
    ...head,
    pattern: ROUTE_PATTERNS.person,
    url: `/people/${LISTING}?card=${IDS.card}${more.search ?? ""}`,
    element: more.element ?? <PersonScreen />,
    stubs: reads(profile, more.posts ?? { posts: [] }),
  };
}

// Maya, the first sample person, as her profile shows her, with her face and her two posts, the first with a photo.
const MAYA = SAMPLE_LISTINGS[0];
const MAYA_PROFILE = profileView({
  listingId: LISTING,
  displayName: "Maya",
  line: MAYA?.line ?? "",
  isSample: true,
  photo: "faces/maya",
  items: MAYA?.items ?? [],
});
const MAYA_POSTS = PostsView.parse({
  posts: SAMPLE_POSTS.filter((post) => post.displayName === "Maya").map((post) => ({
    ...post,
    listingId: LISTING,
  })),
});

// A profile in every friendship state, the Posts tab, and a person who left Explore.
export const views: readonly GalleryView[] = [
  personView({ name: "people-none", title: "Profile, not friends yet" }, profileView({})),
  personView(
    { name: "people-requested", title: "Profile, a request sent" },
    profileView({ friendship: "requested", requestId: REQUEST }),
  ),
  personView(
    { name: "people-incoming", title: "Profile, a request to answer" },
    profileView({ friendship: "incoming", requestId: REQUEST }),
  ),
  personView(
    { name: "people-friends", title: "Profile, friends with friend asks on" },
    profileView({ friendship: "friends", pairId: PAIR, canAsk: true }),
  ),
  personView(
    { name: "people-friends-asks-off", title: "Profile, friends with friend asks off" },
    profileView({ friendship: "friends", pairId: PAIR, canAsk: false }),
  ),
  personView(
    { name: "people-self", title: "Profile, your own listing" },
    profileView({ friendship: "self" }),
  ),
  personView({ name: "people-posts", title: "Profile, the Posts tab" }, profileView({}), {
    element: (
      <AfterSteps steps={[{ press: "Posts" }]}>
        <PersonScreen />
      </AfterSteps>
    ),
  }),
  personView(
    { name: "people-missing", title: "Profile, no longer in Explore" },
    { status: 404, body: { code: "listing_not_found", message: "This listing is gone." } },
  ),
  personView({ name: "people-sample", title: "Profile, a sample person" }, MAYA_PROFILE),
  personView(
    { name: "people-sample-posts", title: "Profile, a sample person's posts as the grid" },
    MAYA_PROFILE,
    { posts: MAYA_POSTS, search: "&tab=posts" },
  ),
  personView(
    { name: "people-sample-posts-list", title: "Profile, a sample person's posts as the list" },
    MAYA_PROFILE,
    {
      posts: MAYA_POSTS,
      search: "&tab=posts",
      element: (
        <AfterSteps steps={[{ press: "List" }]}>
          <PersonScreen />
        </AfterSteps>
      ),
    },
  ),
  personView(
    { name: "people-sample-friends", title: "Profile, friends with a sample person" },
    { ...MAYA_PROFILE, friendship: "friends", pairId: PAIR, canAsk: true },
  ),
];
