import { DirectoryPage } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { ExploreScreen } from "../../../screens/explore/index.js";
import type { GalleryView } from "../gallery-views.js";
import { EXPLORE_LISTINGS, railFriends, railRequests, railStubs } from "./explore.js";

// The signed-in frame with more than 12 friends and 2 requests, around Explore: the rail on a laptop, the tab bar on a phone.
export const views: readonly GalleryView[] = [
  {
    name: "shell-rail-many-friends",
    title: "Signed-in frame, 14 friends and 2 requests",
    pattern: ROUTE_PATTERNS.explore,
    url: "/explore",
    element: <ExploreScreen />,
    stubs: [
      ...railStubs(railFriends(14), railRequests(2)),
      { route: routes.directory.browse, replies: { status: 200, body: DirectoryPage.parse({ listings: EXPLORE_LISTINGS, page: 0, hasMore: false }) } },
      { route: routes.social.listPosts, replies: { status: 200, body: { posts: [] } } },
    ],
  },
];
