import type { ReactElement } from "react";
import type { ProfileView } from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { PersonScreen } from "../../../screens/people/index.js";
import { IDS, profileView } from "../../fixtures.js";
import type { GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { railFriends, railRequests, railStubs } from "./explore.js";
import { AfterSteps } from "./help.js";

// The listing every profile view opens, and the pending request and pair of its friendship states.
const LISTING = "00000000-0000-4000-8000-000000000511";
const REQUEST = "00000000-0000-4000-8000-000000000531";
const PAIR = "00000000-0000-4000-8000-000000000141";

// The page's reads: this profile, and a rail with four friends and one request.
function reads(profile: ProfileView | { status: number; body: unknown }): GalleryStub[] {
  const reply = "status" in profile ? profile : { status: 200, body: profile };
  return [...railStubs(railFriends(4), railRequests(1)), { route: routes.social.readProfile, replies: reply }];
}

// One view of the profile on its route; the card in the address lets a friend's profile offer Meet their agent.
function personView(head: { name: string; title: string }, profile: ProfileView | { status: number; body: unknown }, element: ReactElement = <PersonScreen />): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.person, url: `/people/${LISTING}?card=${IDS.card}`, element, stubs: reads(profile) };
}

// A profile in every friendship state, the Posts tab, and a person who left Explore.
export const views: readonly GalleryView[] = [
  personView({ name: "people-none", title: "Profile, not friends yet" }, profileView({})),
  personView({ name: "people-requested", title: "Profile, a request sent" }, profileView({ friendship: "requested", requestId: REQUEST })),
  personView({ name: "people-incoming", title: "Profile, a request to answer" }, profileView({ friendship: "incoming", requestId: REQUEST })),
  personView({ name: "people-friends", title: "Profile, friends with friend asks on" }, profileView({ friendship: "friends", pairId: PAIR, canAsk: true })),
  personView({ name: "people-friends-asks-off", title: "Profile, friends with friend asks off" }, profileView({ friendship: "friends", pairId: PAIR, canAsk: false })),
  personView({ name: "people-self", title: "Profile, your own listing" }, profileView({ friendship: "self" })),
  personView({ name: "people-posts", title: "Profile, the Posts tab" }, profileView({}), <AfterSteps steps={[{ press: "Posts" }]}><PersonScreen /></AfterSteps>),
  personView({ name: "people-missing", title: "Profile, no longer in Explore" }, { status: 404, body: { code: "listing_not_found", message: "This listing is gone." } }),
];
