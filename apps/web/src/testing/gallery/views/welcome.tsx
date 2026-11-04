import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { CookiesScreen, PrivacyScreen, TermsScreen } from "../../../screens/policies/index.js";
import { ClaimScreen, WelcomeScreen } from "../../../screens/welcome/index.js";
import { IDS, personCreated, RECOVERY_CODE, TRANSFER_TOKEN } from "../../fixtures.js";
import { press, typeInto, type GalleryView } from "../gallery-views.js";

// The start page in each of its states, and the claim page that moves a profile into this browser.
export const views: readonly GalleryView[] = [
  {
    name: "welcome",
    title: "Welcome, the landing page",
    pattern: ROUTE_PATTERNS.welcome,
    url: APP_PATHS.welcome,
    element: <WelcomeScreen />,
  },
  {
    name: "welcome-google",
    title: "Welcome, with Continue with Google",
    pattern: ROUTE_PATTERNS.welcome,
    url: APP_PATHS.welcome,
    element: <WelcomeScreen />,
    stubs: [{ route: routes.people.authOptions, replies: { status: 200, body: { google: true } } }],
  },
  {
    name: "welcome-recovery-code",
    title: "Welcome, the recovery code after making a profile",
    pattern: ROUTE_PATTERNS.welcome,
    url: APP_PATHS.welcome,
    element: <WelcomeScreen />,
    stubs: [{ route: routes.people.createPerson, replies: { status: 201, body: personCreated() } }],
    play: () => {
      typeInto("Your display name", "Mira");
      press("Create my profile");
    },
  },
  {
    name: "welcome-name-error",
    title: "Welcome, a blank display name",
    pattern: ROUTE_PATTERNS.welcome,
    url: APP_PATHS.welcome,
    element: <WelcomeScreen />,
    play: () => {
      typeInto("Your display name", "   ");
      press("Create my profile");
    },
  },
  {
    name: "welcome-code-refused",
    title: "Welcome, a recovery code the server refuses",
    pattern: ROUTE_PATTERNS.welcome,
    url: APP_PATHS.welcome,
    element: <WelcomeScreen />,
    stubs: [
      {
        route: routes.people.recover,
        replies: {
          status: 404,
          body: {
            code: "recovery_code_unknown",
            message: "This code is unknown or was used already.",
          },
        },
      },
    ],
    play: () => {
      typeInto("Recovery code", RECOVERY_CODE);
      press("Sign in with the code");
      document.getElementById("code")?.scrollIntoView();
    },
  },
  {
    name: "claim-ready",
    title: "Claim, a link that moves a profile here",
    pattern: ROUTE_PATTERNS.claim,
    url: `${APP_PATHS.claim}#${TRANSFER_TOKEN}`,
    element: <ClaimScreen />,
    stubs: [
      { route: routes.people.claim, replies: { status: 200, body: { personId: IDS.personA } } },
    ],
  },
  {
    name: "claim-missing",
    title: "Claim, a link with no token",
    pattern: ROUTE_PATTERNS.claim,
    url: APP_PATHS.claim,
    element: <ClaimScreen />,
  },
  {
    name: "privacy",
    title: "Privacy, what Meety keeps",
    pattern: ROUTE_PATTERNS.privacy,
    url: APP_PATHS.privacy,
    element: <PrivacyScreen />,
  },
  {
    name: "terms",
    title: "Terms of using Meety",
    pattern: ROUTE_PATTERNS.terms,
    url: APP_PATHS.terms,
    element: <TermsScreen />,
  },
  {
    name: "cookies",
    title: "Cookies, what Meety keeps in the browser",
    pattern: ROUTE_PATTERNS.cookies,
    url: APP_PATHS.cookies,
    element: <CookiesScreen />,
  },
];
