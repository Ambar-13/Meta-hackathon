import {
  DirectoryListing,
  DirectoryPage,
  FeedPage,
  FriendRequestsView,
  FriendsView,
  PostsView,
  StoriesView,
  type Friend,
  type FriendRequestView,
  type HomeView,
  type Post,
  type Story,
} from "@meet-first/contracts";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { FeedScreen, SearchScreen } from "../../../screens/explore/index.js";
import { FOREVER_MS, type GalleryReply, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { AfterSteps } from "./help.js";
import { IDS, SERVER_NOW } from "../../fixtures.js";

// The gallery's fixed ids for the rail, which the other views reuse.
const ID = (n: number): string => `00000000-0000-4000-8000-${String(950 + n).padStart(12, "0")}`;
// Fourteen first names, so the rail shows 12 and then See all friends.
const NAMES = [
  "Bea",
  "Cal",
  "Jonah",
  "Maximiliana",
  "Ola",
  "Pim",
  "Ravi",
  "Sung-min",
  "Tomasz",
  "Uma",
  "Vik",
  "Wren",
  "Yara",
  "Zed",
];

// The first count friends for the rail; every other one is in Explore and links to their profile.
export function railFriends(count: number): Friend[] {
  return NAMES.slice(0, count).map((displayName, index) => ({
    pairId: ID(index),
    displayName,
    canAsk: index % 3 !== 1,
    listingId: index % 2 === 0 ? ID(20 + index) : null,
  }));
}

// count incoming friend requests for the rail's Friends count.
export function railRequests(count: number): FriendRequestView[] {
  return Array.from({ length: count }, (unused, index) => ({
    requestId: ID(40 + index),
    direction: "incoming" as const,
    otherName: ["Ines", "Kofi", "Lena"][index % 3] ?? "Ines",
    otherListingId: null,
    createdAt: SERVER_NOW,
  }));
}

// The two reads of the rail: these friends and these incoming requests.
export function railStubs(friends: Friend[], incoming: FriendRequestView[] = []): GalleryStub[] {
  const ok = (body: unknown): GalleryReply => ({ status: 200, body });
  return [
    { route: routes.directory.friends, replies: ok(FriendsView.parse({ friends })) },
    {
      route: routes.social.listFriendRequests,
      replies: ok(FriendRequestsView.parse({ incoming, outgoing: [] })),
    },
  ];
}

// The gallery's fixed listing ids.
const LISTING = (n: number): string =>
  `00000000-0000-4000-8000-${String(510 + n).padStart(12, "0")}`;
// Six people in Explore: long and short names and lines, open and closed to dating questions, one with nothing public.
export const EXPLORE_LISTINGS: DirectoryListing[] = [
  {
    listingId: LISTING(1),
    displayName: "Mira",
    line: "Plans first, builds second, demos something small.",
    openToRomance: true,
    isSample: false,
    items: [
      {
        kind: "habit",
        claim: "Writes the plan before the first commit",
        quote: "I can't start until I know what done looks like.",
      },
    ],
  },
  {
    listingId: LISTING(2),
    displayName: "Jonah",
    line: "Night owl who builds to find out.",
    openToRomance: false,
    isSample: false,
    items: [
      {
        kind: "preference",
        claim: "Builds to find out",
        quote: "Easier to show you than to explain it.",
      },
    ],
  },
  {
    listingId: LISTING(3),
    displayName: "Priyanka",
    line: "Design and front end, happy to pair on anything with a screen, and keen to learn some hardware this year.",
    openToRomance: false,
    isSample: false,
    items: [],
  },
  {
    listingId: LISTING(4),
    displayName: "Maximiliana",
    line: "Robotics, coffee, long walks between talks.",
    openToRomance: true,
    isSample: false,
    items: [
      {
        kind: "goal",
        claim: "Wants to ship a hardware hack that people can hold in their hands",
        quote: "This year I want something you can hold.",
      },
    ],
  },
  {
    listingId: LISTING(5),
    displayName: "Ravi",
    line: "Backend and data. Says no to scope creep.",
    openToRomance: false,
    isSample: false,
    items: [
      {
        kind: "value",
        claim: "Says no to scope creep",
        quote: "Someone has to say no to features.",
      },
    ],
  },
  {
    listingId: LISTING(6),
    displayName: "Sung-min",
    line: "First hackathon, here to meet people.",
    openToRomance: false,
    isSample: false,
    items: [
      { kind: "boundary", claim: "Done by 9 pm", quote: "After nine I am no use to anyone." },
    ],
  },
].map((listing) => DirectoryListing.parse(listing));

// Explore as the live site shows it after the seed: one real person first, then the six sample people with their faces,
// lines, first public items and posts with their photos, as packages/db/src/samples/sample-people.ts writes them.
const SAMPLE = (
  n: number,
  listing: { displayName: string; line: string; claim: string; quote: string },
): DirectoryListing =>
  DirectoryListing.parse({
    listingId: LISTING(10 + n),
    displayName: listing.displayName,
    line: listing.line,
    openToRomance: false,
    isSample: true,
    photo: `faces/${listing.displayName.toLowerCase()}`,
    items: [{ kind: "habit", claim: listing.claim, quote: listing.quote }],
  });
// The six sample people as Explore lists them.
export const SAMPLE_LISTINGS: DirectoryListing[] = [
  SAMPLE(1, {
    displayName: "Maya",
    line: "Angel investor. I back small teams early and answer every founder within a week.",
    claim: "Prefers a seed extension to a bridge when the numbers are moving",
    quote: "A seed extension makes sense to me when the numbers are moving",
  }),
  SAMPLE(2, {
    displayName: "Priya",
    line: "Product designer who also writes the front end. I sketch three versions before I pick one.",
    claim: "Sketches three versions of a screen before choosing one",
    quote: "I always sketch three versions of a screen before I pick one",
  }),
  SAMPLE(3, {
    displayName: "Ravi",
    line: "Backend and data. I write the rollback before the feature.",
    claim: "Keeps a not-now list and builds only what still matters",
    quote: "I keep a not-now list. Every idea goes on it",
  }),
  SAMPLE(4, {
    displayName: "Jun",
    line: "First hackathon. I build small robots and I am here to meet people.",
    claim: "Came to the hackathon to meet people more than to win",
    quote: "I came to meet people more than to win",
  }),
  SAMPLE(5, {
    displayName: "Leila",
    line: "Growth. I message every new user myself and keep a waitlist instead of a launch day.",
    claim: "Finds the first users through trust, not ads",
    quote: "The first ten users come from trust, not ads",
  }),
  SAMPLE(6, {
    displayName: "Tomas",
    line: "Machine learning researcher. I never trust a result I have only run once.",
    claim: "Distrusts any result that was run only once",
    quote: "I never trust a result I have only run once",
  }),
];
// The posts of Explore, newest first, dated back from the moment the gallery renders, since a post shows its age against the clock.
const POST = (
  n: number,
  listing: DirectoryListing,
  post: { text: string; hoursAgo: number; photo?: { key: string; alt: string } },
): Post => ({
  postId: LISTING(40 + n),
  listingId: listing.listingId,
  displayName: listing.displayName,
  isSample: listing.isSample,
  text: post.text,
  createdAt: new Date(Date.now() - post.hoursAgo * 3_600_000).toISOString(),
  authorPhoto: listing.photo ?? null,
  photo: post.photo?.key ?? null,
  photoAlt: post.photo?.alt ?? null,
});
const [MAYA, PRIYA, RAVI, JUN, LEILA, TOMAS] = SAMPLE_LISTINGS as [
  DirectoryListing,
  DirectoryListing,
  DirectoryListing,
  DirectoryListing,
  DirectoryListing,
  DirectoryListing,
];
export const SAMPLE_POSTS: Post[] = [
  POST(1, JUN, {
    text: "Looking for a team that needs someone to own the hardware. I bring an Arduino, a box of motors and a soldering iron.",
    hoursAgo: 2,
    photo: {
      key: "jun-workbench",
      alt: "Electronic parts laid out on a white table: an Arduino board, small motors, a battery pack and wires.",
    },
  }),
  POST(2, MAYA, {
    text: "Founders: send me the one number you check every morning. Not the deck, just the number and why it matters to you.",
    hoursAgo: 3,
    photo: { key: "maya-morning", alt: "A latte on a book by a sunny window." },
  }),
  POST(3, PRIYA, {
    text: "Hackathon tip: draw the three screens the judges will see before you write any code. Everything else can wait until Sunday.",
    hoursAgo: 6,
    photo: {
      key: "priya-sketches",
      alt: "A hand sketching phone screens on paper with a yellow pen.",
    },
  }),
  POST(4, RAVI, {
    text: "Before every demo I ask one question: if this breaks on stage, what is the undo? If nobody knows, we fix that first.",
    hoursAgo: 9,
    photo: { key: "ravi-whiteboard", alt: "A hand drawing circles and arrows on a whiteboard." },
  }),
  POST(5, LEILA, {
    text: "Our best week of sign-ups came from twelve personal messages, not from the launch post. Write to people one at a time.",
    hoursAgo: 12,
    photo: {
      key: "leila-letters",
      alt: "Handwritten letters and old envelopes spread on a table.",
    },
  }),
  POST(6, TOMAS, {
    text: "Ran our new model with five seeds instead of one. Two of the five lost to the baseline. Glad we checked before the demo.",
    hoursAgo: 20,
    photo: { key: "tomas-charts", alt: "Charts and graphs on a dark laptop screen." },
  }),
  POST(7, MAYA, {
    text: "A reminder I give every team I back: bad news early is a favour. I can help with a problem in March. I can't help with a surprise in June.",
    hoursAgo: 30,
  }),
  POST(8, JUN, {
    text: "Got a two-wheel robot to follow a line on my desk tonight. It still falls off the edge, but it is getting there.",
    hoursAgo: 40,
    photo: { key: "jun-robot", alt: "A small boxy robot toy on a wooden desk." },
  }),
  POST(9, PRIYA, {
    text: "Tested our sign-up page on my mom today. She found the button in four seconds. Shipping it.",
    hoursAgo: 52,
    photo: {
      key: "priya-phone",
      alt: "Two hands holding a phone with an app open, over a wooden table.",
    },
  }),
  POST(10, TOMAS, {
    text: "If your eval looks too good, check where the test data came from. Nine times out of ten that is the whole story.",
    hoursAgo: 70,
  }),
];

// The stories of Home, as the live site shows them after the seed: Mira's story of words an hour ago, then each sample
// person's newest photo post as their story, as GET /api/stories gives them.
const MIRA_LISTING = EXPLORE_LISTINGS[0] as DirectoryListing;
const STORIES: Story[] = [
  {
    storyId: LISTING(80),
    listingId: MIRA_LISTING.listingId,
    displayName: MIRA_LISTING.displayName,
    isSample: false,
    isMine: false,
    authorPhoto: null,
    text: "Shipping the stories row tonight. Who wants to test it with me?",
    photo: null,
    photoAlt: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiresAt: new Date(Date.now() + 23 * 3_600_000).toISOString(),
  },
  ...SAMPLE_POSTS.filter((post) => post.photo !== null)
    .filter(
      (post, index, all) => all.findIndex((other) => other.listingId === post.listingId) === index,
    )
    .map((post) => ({
      storyId: post.postId,
      listingId: post.listingId,
      displayName: post.displayName,
      isSample: true,
      isMine: false,
      authorPhoto: post.authorPhoto ?? null,
      text: post.text,
      photo: post.photo ?? null,
      photoAlt: post.photoAlt ?? null,
      createdAt: post.createdAt,
      expiresAt: null,
    })),
];
// Ana's home view with an approved card, so the feed shows no next step and Your story shows her initial.
const FEED_HOME: HomeView = {
  displayName: "Ana",
  source: { id: IDS.source, namesPassDone: true, namesReviewed: true },
  card: { id: IDS.card, state: "approved", itemCount: 2, items: [] },
  meetings: [],
  pairs: [],
  serverNow: SERVER_NOW,
};

// One page of Explore.
function page(listings: DirectoryListing[], hasMore: boolean): GalleryReply {
  return { status: 200, body: DirectoryPage.parse({ listings, page: 0, hasMore }) };
}

// The posts reply of Explore.
function postsReply(posts: Post[]): GalleryReply {
  return { status: 200, body: PostsView.parse({ posts }) };
}

// The feed's two parts as GET /api/feed answers them, one page each: the friends' posts, then everyone else's.
function feedReplies(friendsPosts: Post[], otherPosts: Post[]): GalleryReply[] {
  return [friendsPosts, otherPosts].map((posts) => ({
    status: 200,
    body: FeedPage.parse({ posts, next: null }),
  }));
}

// The page's reads: these Explore replies, these posts and stories (none unless given), the feed (Jun's posts as a friend's, then the
// rest, unless given), these friends (the rail's five unless given), and Ana's home view.
function reads(
  pages: GalleryReply | GalleryReply[],
  others: {
    posts?: GalleryReply;
    feed?: GalleryReply[];
    stories?: Story[];
    friends?: Friend[];
  } = {},
): GalleryStub[] {
  return [
    ...railStubs(others.friends ?? railFriends(5)),
    { route: routes.directory.browse, replies: pages },
    { route: routes.social.listPosts, replies: others.posts ?? postsReply([]) },
    { route: routes.social.listFeed, replies: others.feed ?? feedReplies([], []) },
    {
      route: routes.social.listStories,
      replies: { status: 200, body: StoriesView.parse({ stories: others.stories ?? [] }) },
    },
    { route: routes.people.readHome, replies: { status: 200, body: FEED_HOME } },
  ];
}

// The rail's five friends and Jun, a sample person whose agent can be asked, so the feed shows Ask Meety on Jun's post.
const FEED_FRIENDS: Friend[] = [
  ...railFriends(5),
  { pairId: LISTING(60), displayName: JUN.displayName, canAsk: true, listingId: JUN.listingId },
];

// One view of Home, the feed, on its route.
function feedView(
  head: { name: string; title: string },
  stubs: GalleryStub[],
  element = <FeedScreen />,
): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.home, url: "/home", element, stubs };
}

// One view of Search on its route.
function searchView(
  head: { name: string; title: string },
  stubs: GalleryStub[],
  element = <SearchScreen />,
): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.search, url: "/search", element, stubs };
}

// Home: the feed as the live site shows it, with one friend in it, loading, and a failed load. Search: the people it suggests over the
// photos, everyone after See everyone, and a search that finds nobody.
export const views: readonly GalleryView[] = [
  feedView(
    { name: "home-feed", title: "Home, the feed" },
    reads(page([...EXPLORE_LISTINGS.slice(0, 1), ...SAMPLE_LISTINGS], false), {
      posts: postsReply(SAMPLE_POSTS),
      stories: STORIES,
      friends: FEED_FRIENDS,
      feed: feedReplies(
        SAMPLE_POSTS.filter((post) => post.listingId === JUN.listingId),
        SAMPLE_POSTS.filter((post) => post.listingId !== JUN.listingId).map((post, index) => ({
          ...post,
          isLiked: index === 0,
        })),
      ),
    }),
  ),
  feedView(
    { name: "home-story", title: "Home, Maya's story open" },
    reads(page([...EXPLORE_LISTINGS.slice(0, 1), ...SAMPLE_LISTINGS], false), {
      posts: postsReply(SAMPLE_POSTS),
      stories: STORIES,
      friends: FEED_FRIENDS,
    }),
    <AfterSteps steps={[{ press: "Maya, new story" }, { press: "Pause" }]}>
      <FeedScreen />
    </AfterSteps>,
  ),
  feedView(
    { name: "home-story-words", title: "Home, Mira's story of words open" },
    reads(page([...EXPLORE_LISTINGS.slice(0, 1), ...SAMPLE_LISTINGS], false), {
      posts: postsReply(SAMPLE_POSTS),
      stories: STORIES,
      friends: FEED_FRIENDS,
    }),
    <AfterSteps steps={[{ press: "Mira, new story" }, { press: "Pause" }]}>
      <FeedScreen />
    </AfterSteps>,
  ),
  feedView(
    { name: "home-loading", title: "Home, loading" },
    reads({ ...page(EXPLORE_LISTINGS, false), delayMs: FOREVER_MS }),
  ),
  feedView(
    { name: "home-error", title: "Home, the people failed to load" },
    reads({
      status: 500,
      body: {
        code: "server_error",
        message: "Something went wrong on our side. Try again in a minute.",
      },
    }),
  ),
  searchView(
    { name: "search", title: "Search, the people it suggests and the photos" },
    reads(page([...EXPLORE_LISTINGS.slice(0, 1), ...SAMPLE_LISTINGS], false), {
      posts: postsReply(SAMPLE_POSTS),
      friends: FEED_FRIENDS,
    }),
  ),
  searchView(
    { name: "search-everyone", title: "Search, everyone after See everyone" },
    reads(page([...EXPLORE_LISTINGS, ...SAMPLE_LISTINGS], true)),
    <AfterSteps steps={[{ press: "See everyone" }]}>
      <SearchScreen />
    </AfterSteps>,
  ),
  searchView(
    { name: "search-empty", title: "Search, a search that finds nobody" },
    reads([page(EXPLORE_LISTINGS, false), page([], false)]),
    <AfterSteps steps={[{ type: "underwater robots", into: "Search people" }, { press: "Search" }]}>
      <SearchScreen />
    </AfterSteps>,
  ),
];
