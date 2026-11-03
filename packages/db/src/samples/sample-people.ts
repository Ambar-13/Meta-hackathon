// The sample people of Explore (3 Nov 2026): six made-up people, first names only, so Explore has people, posts and profiles to try
// before real people list themselves. Each has notes in their own words, a card whose items quote those notes word for word, a line
// for Explore and a post or two. pnpm db:seed-samples writes them (seed-samples.ts); the app marks each one Sample, and each accepts
// a friend request at once (migration 0009). None of them is a real person.
import type { ItemKind } from "@meet-first/contracts";

// One item of a sample card: its kind and claim, the note it quotes by index, the quote, which must be part of that note word for
// word, and whether Explore shows it.
export type SampleItem = { kind: ItemKind; claim: string; note: number; quote: string; isPublic: boolean };
// A photo of a sample post: its key, which the web build maps to the bundled image (apps/web/src/look/sample-photos.ts), and the words
// a screen reader reads for it. The photos are free Unsplash photos picked on 3 Nov 2026 (docs/sample-photos.md).
export type SamplePhoto = { key: string; alt: string };
// One sample post, dated this many hours before the seed runs, so the feed reads as a few days of posts, with its photo when it has one.
export type SamplePost = { text: string; hoursAgo: number; photo?: SamplePhoto };
// One sample person, with the key of the face the app shows for them (Ambar, 3 Nov: "cute human avatars", marked as made up).
export type SamplePerson = { displayName: string; face: string; line: string; notes: readonly string[]; items: readonly SampleItem[]; posts: readonly SamplePost[] };

// The six sample people, in the order the seed adds them.
export const SAMPLE_PEOPLE: readonly SamplePerson[] = [
  {
    displayName: "Maya",
    face: "faces/maya",
    line: "Angel investor. I back small teams early and answer every founder within a week.",
    notes: [
      "A seed extension makes sense to me when the numbers are moving and the team just needs six more months.",
      "I get nervous about bridge rounds. A bridge usually means the plan changed and nobody has said so yet.",
      "I decide within a week. If I need longer than that, the answer is probably no, and I would rather say so.",
      "Tell me the bad news first. I trust a founder more after they tell me what went wrong.",
      "I read the monthly update before the deck. The update shows me how the team thinks when nobody is pitching.",
      "I don't need a big market slide. I want to know who paid you last month and why.",
      "When a founder asks for advice, I give it once and then let them decide. It is their company.",
      "I say no to anything that needs me on the board. I like to help from the side.",
    ],
    items: [
      { kind: "preference", claim: "Prefers a seed extension to a bridge when the numbers are moving", note: 0, quote: "A seed extension makes sense to me when the numbers are moving", isPublic: true },
      { kind: "boundary", claim: "Gets wary of bridge rounds, which often hide a changed plan", note: 1, quote: "A bridge usually means the plan changed and nobody has said so yet", isPublic: true },
      { kind: "habit", claim: "Decides on an investment within a week", note: 2, quote: "I decide within a week. If I need longer than that, the answer is probably no", isPublic: true },
      { kind: "value", claim: "Trusts founders who share bad news first", note: 3, quote: "Tell me the bad news first. I trust a founder more after they tell me what went wrong.", isPublic: true },
      { kind: "habit", claim: "Reads the monthly update before the pitch deck", note: 4, quote: "I read the monthly update before the deck", isPublic: false },
      { kind: "boundary", claim: "Will not take a board seat", note: 7, quote: "I say no to anything that needs me on the board", isPublic: false },
    ],
    posts: [
      { text: "Founders: send me the one number you check every morning. Not the deck, just the number and why it matters to you.", hoursAgo: 3, photo: { key: "maya-morning", alt: "A latte on a book by a sunny window." } },
      { text: "A reminder I give every team I back: bad news early is a favour. I can help with a problem in March. I can't help with a surprise in June.", hoursAgo: 30 },
    ],
  },
  {
    displayName: "Priya",
    face: "faces/priya",
    line: "Product designer who also writes the front end. I sketch three versions before I pick one.",
    notes: [
      "I always sketch three versions of a screen before I pick one. The first idea is usually the obvious one.",
      "No dark patterns, ever. If a button tricks people into staying, I won't design it.",
      "On a hackathon team I build the demo flow first, the three screens the judges will actually see.",
      "I test my designs on my mom. If she can't find the main button in five seconds, I start over.",
      "I like working next to the backend person, so we agree on the data before I draw anything.",
      "Fonts are not where I spend my time. I pick one good one and get on with it.",
      "I need about an hour of quiet in the morning to design. After that I am happy to talk all day.",
      "Feedback is easiest for me when it comes with the screen open, pointing at the exact thing.",
    ],
    items: [
      { kind: "habit", claim: "Sketches three versions of a screen before choosing one", note: 0, quote: "I always sketch three versions of a screen before I pick one", isPublic: true },
      { kind: "boundary", claim: "Refuses to design dark patterns", note: 1, quote: "If a button tricks people into staying, I won't design it", isPublic: true },
      { kind: "habit", claim: "Builds the demo flow first at a hackathon", note: 2, quote: "I build the demo flow first, the three screens the judges will actually see", isPublic: true },
      { kind: "value", claim: "Tests every design on someone outside tech", note: 3, quote: "I test my designs on my mom. If she can't find the main button in five seconds, I start over.", isPublic: true },
      { kind: "preference", claim: "Agrees on the data with the backend person before drawing", note: 4, quote: "we agree on the data before I draw anything", isPublic: false },
      { kind: "habit", claim: "Needs a quiet hour in the morning to design", note: 6, quote: "I need about an hour of quiet in the morning to design", isPublic: false },
    ],
    posts: [
      { text: "Hackathon tip: draw the three screens the judges will see before you write any code. Everything else can wait until Sunday.", hoursAgo: 6, photo: { key: "priya-sketches", alt: "A hand sketching phone screens on paper with a yellow pen." } },
      { text: "Tested our sign-up page on my mom today. She found the button in four seconds. Shipping it.", hoursAgo: 52, photo: { key: "priya-phone", alt: "Two hands holding a phone with an app open, over a wooden table." } },
    ],
  },
  {
    displayName: "Ravi",
    face: "faces/ravi",
    line: "Backend and data. I write the rollback before the feature.",
    notes: [
      "I keep a not-now list. Every idea goes on it, and we only build what still matters on Friday.",
      "I would rather ship a boring feature that works than a clever one that breaks at the demo.",
      "When something breaks, I read the logs before I touch the code. Most bugs tell you where they are.",
      "I write the rollback first. If I can't undo a change, I am not ready to make it.",
      "Give me a clear schema and I am happy. Give me a vague one and I will ask a lot of questions.",
      "I don't like all-nighters. Tired people write the bugs that cost the next day.",
      "I explain things with a drawing of boxes and arrows. It saves an hour of talking.",
      "I care more about the data being right than the page being fast.",
    ],
    items: [
      { kind: "habit", claim: "Keeps a not-now list and builds only what still matters", note: 0, quote: "I keep a not-now list. Every idea goes on it", isPublic: true },
      { kind: "value", claim: "Prefers a boring feature that works to a clever one that breaks", note: 1, quote: "I would rather ship a boring feature that works than a clever one that breaks at the demo", isPublic: true },
      { kind: "habit", claim: "Reads the logs before touching the code", note: 2, quote: "When something breaks, I read the logs before I touch the code", isPublic: true },
      { kind: "habit", claim: "Writes the rollback before the change", note: 3, quote: "I write the rollback first. If I can't undo a change, I am not ready to make it.", isPublic: true },
      { kind: "boundary", claim: "Avoids all-nighters", note: 5, quote: "I don't like all-nighters. Tired people write the bugs that cost the next day.", isPublic: false },
      { kind: "preference", claim: "Explains ideas with drawings of boxes and arrows", note: 6, quote: "I explain things with a drawing of boxes and arrows", isPublic: false },
    ],
    posts: [
      { text: "Before every demo I ask one question: if this breaks on stage, what is the undo? If nobody knows, we fix that first.", hoursAgo: 9, photo: { key: "ravi-whiteboard", alt: "A hand drawing circles and arrows on a whiteboard." } },
    ],
  },
  {
    displayName: "Jun",
    face: "faces/jun",
    line: "First hackathon. I build small robots and I am here to meet people.",
    notes: [
      "This is my first hackathon. Honestly I came to meet people more than to win.",
      "I build small robots at home, mostly with an Arduino and whatever motors I can find.",
      "If the team needs hardware, I will own it. Wires, sensors, the soldering, all of it.",
      "I am quiet in big groups. One on one I talk a lot more.",
      "I learn fastest by breaking things. I would rather try it and see than read the whole manual.",
      "I want a team that explains things instead of just doing them for me.",
      "I am bad at pitching. I would happily build the demo if someone else does the talking.",
      "Sleep matters to me. I will stay late, but I want a few hours before the final day.",
    ],
    items: [
      { kind: "goal", claim: "Came to the hackathon to meet people more than to win", note: 0, quote: "I came to meet people more than to win", isPublic: true },
      { kind: "habit", claim: "Builds small robots at home", note: 1, quote: "I build small robots at home, mostly with an Arduino", isPublic: true },
      { kind: "preference", claim: "Will own the hardware on a team", note: 2, quote: "If the team needs hardware, I will own it", isPublic: true },
      { kind: "habit", claim: "Learns fastest by breaking things", note: 4, quote: "I learn fastest by breaking things", isPublic: true },
      { kind: "preference", claim: "Talks more one on one than in big groups", note: 3, quote: "I am quiet in big groups. One on one I talk a lot more.", isPublic: false },
      { kind: "boundary", claim: "Would rather build the demo than pitch it", note: 6, quote: "I would happily build the demo if someone else does the talking", isPublic: false },
    ],
    posts: [
      { text: "Looking for a team that needs someone to own the hardware. I bring an Arduino, a box of motors and a soldering iron.", hoursAgo: 2, photo: { key: "jun-workbench", alt: "Electronic parts laid out on a white table: an Arduino board, small motors, a battery pack and wires." } },
      { text: "Got a two-wheel robot to follow a line on my desk tonight. It still falls off the edge, but it is getting there.", hoursAgo: 40, photo: { key: "jun-robot", alt: "A small boxy robot toy on a wooden desk." } },
    ],
  },
  {
    displayName: "Leila",
    face: "faces/leila",
    line: "Growth. I message every new user myself and keep a waitlist instead of a launch day.",
    notes: [
      "The first ten users come from trust, not ads. Friends of friends who will tell you the truth.",
      "I message every new user myself in the first week. Their first reply tells me more than any dashboard.",
      "I would take a small waitlist over a big launch day. A waitlist teaches you something every day.",
      "I don't buy followers or fake reviews. If the numbers are not real, they are useless to me.",
      "I watch where people stop on the sign-up page. That is usually where the next fix is.",
      "I write the onboarding email before we build the feature. If I can't explain it, people won't use it.",
      "I like teams that ship every week. Growth needs something new to talk about.",
      "I measure one number at a time. Five numbers at once and nobody knows what to fix.",
    ],
    items: [
      { kind: "value", claim: "Finds the first users through trust, not ads", note: 0, quote: "The first ten users come from trust, not ads", isPublic: true },
      { kind: "habit", claim: "Messages every new user in their first week", note: 1, quote: "I message every new user myself in the first week", isPublic: true },
      { kind: "preference", claim: "Prefers a small waitlist to a big launch day", note: 2, quote: "I would take a small waitlist over a big launch day", isPublic: true },
      { kind: "boundary", claim: "Never buys followers or fake reviews", note: 3, quote: "I don't buy followers or fake reviews. If the numbers are not real, they are useless to me.", isPublic: true },
      { kind: "habit", claim: "Writes the onboarding email before the feature is built", note: 5, quote: "I write the onboarding email before we build the feature", isPublic: false },
      { kind: "habit", claim: "Tracks one number at a time", note: 7, quote: "I measure one number at a time. Five numbers at once and nobody knows what to fix.", isPublic: false },
    ],
    posts: [
      { text: "Our best week of sign-ups came from twelve personal messages, not from the launch post. Write to people one at a time.", hoursAgo: 12, photo: { key: "leila-letters", alt: "Handwritten letters and old envelopes spread on a table." } },
    ],
  },
  {
    displayName: "Tomas",
    face: "faces/tomas",
    line: "Machine learning researcher. I never trust a result I have only run once.",
    notes: [
      "I never trust a result I have only run once. Run it three times with different seeds, then we can talk.",
      "I like small, honest benchmarks more than big leaderboards. A leaderboard rewards whoever tuned the longest.",
      "The first thing I build is a baseline so simple it is almost embarrassing. Everything has to beat it.",
      "I write down what I expect before I run an experiment. Otherwise I fool myself afterwards.",
      "I am happy to review anyone's eval. I will mostly ask where the test data came from.",
      "I work in long quiet blocks. Messages can wait two hours.",
      "Negative results are results. I would rather publish what failed than hide it.",
      "If a model looks too good, I check for leakage before I celebrate.",
    ],
    items: [
      { kind: "value", claim: "Distrusts any result that was run only once", note: 0, quote: "I never trust a result I have only run once", isPublic: true },
      { kind: "preference", claim: "Prefers small honest benchmarks to leaderboards", note: 1, quote: "I like small, honest benchmarks more than big leaderboards", isPublic: true },
      { kind: "habit", claim: "Starts with a baseline so simple it is almost embarrassing", note: 2, quote: "The first thing I build is a baseline so simple it is almost embarrassing", isPublic: true },
      { kind: "habit", claim: "Writes down the expected result before running an experiment", note: 3, quote: "I write down what I expect before I run an experiment", isPublic: true },
      { kind: "value", claim: "Treats negative results as results", note: 6, quote: "Negative results are results. I would rather publish what failed than hide it.", isPublic: false },
      { kind: "habit", claim: "Checks for leakage when a model looks too good", note: 7, quote: "If a model looks too good, I check for leakage before I celebrate", isPublic: false },
    ],
    posts: [
      { text: "Ran our new model with five seeds instead of one. Two of the five lost to the baseline. Glad we checked before the demo.", hoursAgo: 20, photo: { key: "tomas-charts", alt: "Charts and graphs on a dark laptop screen." } },
      { text: "If your eval looks too good, check where the test data came from. Nine times out of ten that is the whole story.", hoursAgo: 70 },
    ],
  },
];
