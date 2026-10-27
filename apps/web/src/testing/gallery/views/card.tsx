import type { ReactElement } from "react";
import { MyListing, type CardView } from "@meet-first/contracts";
import { APP_PATHS, rememberAllowlist, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { CardScreen } from "../../../screens/card/index.js";
import { QuoteSheet } from "../../../screens/card/card-items.js";
import { cardView, IDS, SERVER_NOW } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// The card page's address for the fixture card.
const CARD_URL = APP_PATHS.card(IDS.card);
// Item claims and quotes that read like a real card, in card order.
const REAL_ITEMS = [
  { claim: "Plans before building", quote: "I can't start until I know what done looks like." },
  { claim: "Prefers mornings for hard work", quote: "I work best before nine in the morning." },
  { claim: "Gets things done by the evening", quote: "If it is not done by 9 pm it waits until tomorrow." },
  { claim: "Hates pitching in front of people", quote: "Please don't make me present." },
  { claim: "Wants to ship something small that works", quote: "A small demo that works beats a big one that doesn't." },
  { claim: "Likes to talk ideas through out loud", quote: "Let me think out loud for a second." },
] as const;

// The fixture card with the claims and quotes above.
function realCard(state: CardView["state"]): CardView {
  const view = cardView(state);
  view.items = view.items.map((item, index) => ({ ...item, ...(REAL_ITEMS[index] ?? {}) }));
  return view;
}

// A ready card with every kind of row: item 3 in another language with its gloss, item 4 with no quote found, item 5 with a weak one.
function mixedCard(): CardView {
  const view = realCard("ready");
  view.items = view.items.map((item) => {
    if (item.position === 3) return { ...item, lang: "es", claim: "Termina todo antes de las nueve", gloss: "Gets everything done before nine" };
    if (item.position === 4) return { ...item, verified: false, flagged: true };
    if (item.position === 5) return { ...item, flagged: true };
    return item;
  });
  return view;
}

// An approved card with item 4 left out, which is the usual shape after approving.
function approvedCard(): CardView {
  const view = realCard("approved");
  view.items = view.items.map((item) => (item.position === 4 ? { ...item, approved: false } : item));
  return view;
}

// The person's listing on the fixture card, open to dating questions.
function listing(): MyListing {
  return MyListing.parse({ listingId: "00000000-0000-4000-8000-000000000501", cardId: IDS.card, line: "Builds hackathon tools and plans before coding", openToRomance: true, items: [{ kind: "value", claim: "Plans before building", quote: "I can't start until I know what done looks like." }], createdAt: SERVER_NOW });
}

// The first item of the ready card, for the quote sheet.
function firstItem(): CardView["items"][number] {
  const item = realCard("ready").items[0];
  if (item === undefined) throw new Error("the ready card has no items");
  return item;
}

// The card page as a tab that typed the name Mira at signup, so the name tag shows.
const CardAsMira = (): ReactElement => {
  rememberAllowlist("Mira", []);
  return <CardScreen />;
};

// The two reads of the Sharing section for a person who shares nothing and is not listed.
const NOTHING_SHARED: readonly GalleryStub[] = [
  { route: routes.directory.readSharing, replies: { status: 200, body: { friendsCanAsk: false, publicPositions: [] } } },
  { route: routes.directory.readMyListing, replies: { status: 404, body: { code: "not_listed", message: "You are not in the directory." } } },
];

// One card view on the card route, as Mira, reading the given card.
function cardOnRoute(label: { name: string; title: string }, card: CardView, extra: readonly GalleryStub[] = []): GalleryView {
  return { ...label, pattern: ROUTE_PATTERNS.card, url: CARD_URL, element: <CardAsMira />, stubs: [{ route: routes.cards.readCard, replies: { status: 200, body: card } }, ...extra] };
}

// The card page in each state, the quote sheet, and the Sharing section in each of its states.
export const views: readonly GalleryView[] = [
  { name: "card-loading", title: "Card, loading", pattern: ROUTE_PATTERNS.card, url: CARD_URL, element: <CardScreen />, stubs: [{ route: routes.cards.readCard, replies: { status: 200, body: cardView("ready"), delayMs: FOREVER_MS } }] },
  { name: "card-error", title: "Card, could not load", pattern: ROUTE_PATTERNS.card, url: CARD_URL, element: <CardScreen /> },
  cardOnRoute({ name: "card-building", title: "Card, building" }, cardView("building")),
  cardOnRoute({ name: "card-ready", title: "Card, ready to approve" }, mixedCard()),
  cardOnRoute({ name: "card-thin", title: "Card, thin" }, realCard("thin")),
  cardOnRoute({ name: "card-empty", title: "Card, no items" }, { ...cardView("ready"), items: [] }),
  cardOnRoute({ name: "card-failed", title: "Card, failed to build" }, cardView("failed")),
  cardOnRoute({ name: "card-approved", title: "Card, approved, nothing shared" }, approvedCard(), NOTHING_SHARED),
  cardOnRoute({ name: "card-approved-thin", title: "Card, thin and approved" }, { ...realCard("thin"), state: "approved", items: realCard("thin").items.map((item) => ({ ...item, approved: true })) }, NOTHING_SHARED),
  cardOnRoute({ name: "card-sharing-listed", title: "Card, approved, listed and open to dating" }, approvedCard(), [
    { route: routes.directory.readSharing, replies: { status: 200, body: { friendsCanAsk: true, publicPositions: [1, 2] } } },
    { route: routes.directory.readMyListing, replies: { status: 200, body: listing() } },
  ]),
  cardOnRoute({ name: "card-sharing-loading", title: "Card, approved, sharing loading" }, approvedCard(), [
    { route: routes.directory.readSharing, replies: { status: 200, body: { friendsCanAsk: false, publicPositions: [] }, delayMs: FOREVER_MS } },
  ]),
  cardOnRoute({ name: "card-sharing-error", title: "Card, approved, sharing could not load" }, approvedCard()),
  {
    name: "card-quote",
    title: "Card, the quote sheet",
    pattern: ROUTE_PATTERNS.card,
    url: CARD_URL,
    element: <QuoteSheet cardId={IDS.card} item={firstItem()} onClose={() => undefined} />,
    stubs: [
      { route: routes.cards.readCard, replies: { status: 200, body: realCard("ready") } },
      { route: routes.cards.readItemSource, replies: { status: 200, body: { turnIndex: 0, text: "Honestly? I can't start until I know what done looks like. Then I'm fast.", highlight: { start: 9, end: 58 } } } },
    ],
  },
];
