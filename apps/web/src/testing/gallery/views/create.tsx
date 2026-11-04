import { MyListing } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { CreateScreen } from "../../../screens/create/index.js";
import { IDS, SERVER_NOW } from "../../fixtures.js";
import type { GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { railFriends, railStubs } from "./explore.js";
import { AfterSteps } from "./help.js";

// Ana's listing, so Create knows she is in Explore.
const LISTED = MyListing.parse({
  listingId: "00000000-0000-4000-8000-000000000501",
  cardId: IDS.card,
  line: "Builds hackathon tools",
  openToRomance: false,
  items: [],
  createdAt: SERVER_NOW,
});
// The page's reads: the rail and Ana's listing, or a 404 for someone not in Explore.
function reads(isListed: boolean): GalleryStub[] {
  const listing = isListed
    ? { status: 200, body: LISTED }
    : { status: 404, body: { code: "not_listed", message: "You are not in Explore yet." } };
  return [
    ...railStubs(railFriends(5)),
    { route: routes.directory.readMyListing, replies: listing },
  ];
}

// Create: a new post before anything is chosen, a caption typed by someone not in Explore, and a
// new story.
export const views: readonly GalleryView[] = [
  {
    name: "create-post",
    title: "Create, a new post",
    pattern: ROUTE_PATTERNS.create,
    url: "/create",
    element: <CreateScreen />,
    stubs: reads(true),
  },
  {
    name: "create-post-words",
    title: "Create, a caption by someone not in Explore",
    pattern: ROUTE_PATTERNS.create,
    url: "/create",
    stubs: reads(false),
    element: (
      <AfterSteps
        steps={[
          {
            type: "Shipping the stories row tonight. Who wants to test it with me?",
            into: "Caption",
          },
        ]}
      >
        <CreateScreen />
      </AfterSteps>
    ),
  },
  {
    name: "create-story",
    title: "Create, a new story",
    pattern: ROUTE_PATTERNS.create,
    url: "/create?kind=story",
    element: <CreateScreen />,
    stubs: reads(true),
  },
];
