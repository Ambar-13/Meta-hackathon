import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { WelcomeScreen } from "../../../screens/welcome/index.js";
import { personCreated } from "../../fixtures.js";
import type { GalleryView } from "../gallery-views.js";

// The start page: the landing with the name-tag form, then the recovery code once a profile is made.
export const views: readonly GalleryView[] = [
  {
    name: "welcome",
    title: "Welcome, the landing page",
    pattern: ROUTE_PATTERNS.welcome,
    url: "/",
    element: <WelcomeScreen />,
    stubs: [{ route: routes.people.createPerson, replies: { status: 201, body: personCreated() } }],
  },
];
