// What the head of each public page says to search engines, link previews and AI fetchers. Every
// line repeats what the page itself shows; nothing here claims what the page does not. The live
// origin is written as ORIGIN_PLACEHOLDER, which the api swaps for its APP_ORIGIN, so one build
// serves any domain.

// The text that stands for the live origin in the prerendered files; the api's public-pages.ts
// replaces it. Never a trailing slash after it.
export const ORIGIN_PLACEHOLDER = "__APP_ORIGIN__";

// The head of one public page: the path it lives at, the words a search result shows, the words a
// link preview shows, and a line of the page's own text that proves the render worked. Every page's
// preview carries the share picture (og.png).
export type PageHead = {
  path: string;
  title: string;
  description: string;
  shareTitle: string;
  mustContain: string;
};

// The four public pages' heads. Titles are about 50 to 60 characters with the brand last, the
// shape search engines rewrite least; descriptions are one or two sentences with the page's main
// fact and its action.
export const PAGE_HEADS: readonly PageHead[] = [
  {
    path: "/",
    title: "Meety: the next generation of social media with context",
    description:
      "Ask what someone would care about, want, dislike, or debate before the real conversation begins. Their Meety answers only from context they chose to share.",
    shareTitle: "Meety: the next generation of social media, with context.",
    mustContain: "next generation",
  },
  {
    path: "/privacy",
    title: "Privacy - what Meety keeps, who sees it, how to delete it",
    description:
      "What Meety keeps, what it does with it, who sees what, the two cookies, and how deleting your account removes everything that belongs to you.",
    shareTitle: "Meety's privacy page",
    mustContain: "What Meety keeps",
  },
  {
    path: "/terms",
    title: "Terms - the rules of using Meety",
    description:
      "What Meety is and is not, your account, what you may upload and post, what is not allowed, what Meety promises, and how to leave.",
    shareTitle: "Meety's terms",
    mustContain: "What Meety is",
  },
  {
    path: "/cookies",
    title: "Cookies - what Meety keeps in your browser",
    description:
      "The two cookies that sign you in, the two notes the app keeps in your browser, Google's own sign-in page, and how to remove them.",
    shareTitle: "Meety's cookies page",
    mustContain: "Removing them",
  },
];

// The structured data of the start page, as a JSON-LD graph: the site and the web app it is. Each
// value repeats a line the page shows; there is no rating, no count and no claim about people.
export const HOME_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${ORIGIN_PLACEHOLDER}/#website`,
      url: `${ORIGIN_PLACEHOLDER}/`,
      name: "Meety",
      alternateName: "Meety: social media with context",
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${ORIGIN_PLACEHOLDER}/#app`,
      name: "Meety",
      url: `${ORIGIN_PLACEHOLDER}/`,
      isPartOf: { "@id": `${ORIGIN_PLACEHOLDER}/#website` },
      applicationCategory: "SocialNetworkingApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description:
        "Meety is a free social network with context. Each person has a Meety, an AI built from information they approve. Friends can ask what someone may care about, want, dislike or debate, and every answer keeps its source attached.",
      keywords: [
        "the new social network",
        "AI social network",
        "AI of you from your own chats",
        "social media with context",
        "people are more than profiles",
        "ask a friend's AI",
      ],
      featureList: [
        "Choose context from ChatGPT, Claude, Codex, notes or a paste",
        "Approve every point before anyone can ask about it",
        "Ask what someone may care about, want, dislike, know or debate",
        "It says probably, never what you will do",
        "It never scores anyone",
        "Messages are scrubbed in your browser before anything is sent",
        "Delete your account and everything goes with it",
      ],
    },
  ],
} as const;
