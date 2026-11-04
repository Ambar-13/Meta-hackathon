import { useEffect, type ReactElement, type ReactNode } from "react";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { JoinScreen, PairScreen } from "../../../screens/pair/index.js";
import { IDS, INVITE_TOKEN, personCreated } from "../../fixtures.js";
import { FOREVER_MS } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// How long a view waits before it presses its button, so the screen has rendered first.
const PRESS_AFTER_MS = 300;
// The invite the pair page shows once it is made.
const INVITE = {
  pairId: IDS.pair,
  inviteUrl: `https://meetfirst.example/join#${INVITE_TOKEN}`,
  expiresAt: "2026-10-28T10:00:00.000Z",
};
// The sentence the server sends for a used or expired invite.
const UNAVAILABLE =
  "This invite was already used, has expired, or is your own. Ask for a new link.";

// Renders a screen, then taps each button or label whose words end with the given words, in order, to reach a state that needs taps.
export const Press = (props: { steps: readonly string[]; children: ReactNode }): ReactElement => {
  const stepsKey = props.steps.join("|");
  useEffect(() => {
    const timers = props.steps.map((step, index) =>
      setTimeout(
        () => {
          const targets = Array.from(document.querySelectorAll("button, label"));
          const target = targets.find((element) =>
            (element.textContent ?? "").trim().endsWith(step),
          );
          if (target instanceof HTMLElement) target.click();
        },
        PRESS_AFTER_MS * (index + 1),
      ),
    );
    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
    };
  }, [stepsKey]);
  return <>{props.children}</>;
};

// The pair page before, during and after making an invite, and the join page in each of its states.
export const views: readonly GalleryView[] = [
  {
    name: "pair-start",
    title: "Pair, before an invite",
    pattern: ROUTE_PATTERNS.pair,
    url: `/pair?card=${IDS.card}`,
    element: <PairScreen />,
  },
  {
    name: "pair-making",
    title: "Pair, making the invite",
    pattern: ROUTE_PATTERNS.pair,
    url: `/pair?card=${IDS.card}`,
    element: (
      <Press steps={["Make an invite"]}>
        <PairScreen />
      </Press>
    ),
    stubs: [
      {
        route: routes.meetings.createPair,
        replies: { status: 201, body: INVITE, delayMs: FOREVER_MS },
      },
    ],
  },
  {
    name: "pair-invite",
    title: "Pair, the invite and QR code, waiting for them",
    pattern: ROUTE_PATTERNS.pair,
    url: `/pair?card=${IDS.card}`,
    element: (
      <Press steps={["Make an invite"]}>
        <PairScreen />
      </Press>
    ),
    stubs: [{ route: routes.meetings.createPair, replies: { status: 201, body: INVITE } }],
  },
  {
    name: "pair-invite-no-card",
    title: "Pair, the invite without an approved card",
    pattern: ROUTE_PATTERNS.pair,
    url: "/pair",
    element: (
      <Press steps={["Make an invite"]}>
        <PairScreen />
      </Press>
    ),
    stubs: [{ route: routes.meetings.createPair, replies: { status: 201, body: INVITE } }],
  },
  {
    name: "pair-error",
    title: "Pair, the invite could not be made",
    pattern: ROUTE_PATTERNS.pair,
    url: `/pair?card=${IDS.card}`,
    element: (
      <Press steps={["Make an invite"]}>
        <PairScreen />
      </Press>
    ),
    stubs: [
      {
        route: routes.meetings.createPair,
        replies: {
          status: 429,
          body: {
            code: "rate_limited",
            message: "Too many invites in a short time. Try again in a minute.",
          },
        },
      },
    ],
  },
  {
    name: "join-ready",
    title: "Join, an invite to accept",
    pattern: ROUTE_PATTERNS.join,
    url: `/join#${INVITE_TOKEN}`,
    element: <JoinScreen />,
  },
  {
    name: "join-sending",
    title: "Join, accepting",
    pattern: ROUTE_PATTERNS.join,
    url: `/join#${INVITE_TOKEN}`,
    element: (
      <Press steps={["Accept the invite"]}>
        <JoinScreen />
      </Press>
    ),
    stubs: [
      {
        route: routes.meetings.joinPair,
        replies: { status: 200, body: { pairId: IDS.pair }, delayMs: FOREVER_MS },
      },
    ],
  },
  {
    name: "join-needs-profile",
    title: "Join, a profile first",
    pattern: ROUTE_PATTERNS.join,
    url: `/join#${INVITE_TOKEN}`,
    element: (
      <Press steps={["Accept the invite"]}>
        <JoinScreen />
      </Press>
    ),
    stubs: [
      {
        route: routes.meetings.joinPair,
        replies: {
          status: 401,
          body: { code: "session_missing", message: "Sign in again from the start page." },
        },
      },
      { route: routes.people.createPerson, replies: { status: 201, body: personCreated() } },
    ],
  },
  {
    name: "join-expired",
    title: "Join, an expired or used invite",
    pattern: ROUTE_PATTERNS.join,
    url: `/join#${INVITE_TOKEN}`,
    element: (
      <Press steps={["Accept the invite"]}>
        <JoinScreen />
      </Press>
    ),
    stubs: [
      {
        route: routes.meetings.joinPair,
        replies: { status: 409, body: { code: "pair_unavailable", message: UNAVAILABLE } },
      },
    ],
  },
  {
    name: "join-invalid",
    title: "Join, a link with no token",
    pattern: ROUTE_PATTERNS.join,
    url: "/join",
    element: <JoinScreen />,
  },
];
