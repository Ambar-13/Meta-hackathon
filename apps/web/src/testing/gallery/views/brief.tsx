import type { Brief, BriefPoint, Quote } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { BriefScreen } from "../../../screens/brief/index.js";
import { IDS } from "../../fixtures.js";
import type { GalleryView } from "../gallery-views.js";

// The brief page in each of its states, from one sample brief between two made-up people.

// One quote of the sample, on a side, checked or not.
function quote(text: string, side: "a" | "b", isVerified = true): Quote {
  return { text, side, turnId: side === "a" ? IDS.turnA : "00000000-0000-4000-8000-000000000302", verified: isVerified };
}

// One line of the sample with its quotes and whether the check backed it.
function point(text: string, quotes: Quote[], isSupported: boolean | null = true): BriefPoint {
  return { text, quotes, supported: isSupported };
}

// The sample brief of a get-along meeting: three lines per part, one weak, one with a quote that did not match.
const SAMPLE: Brief = {
  questionKind: "get_along",
  supportRate: 0.89,
  supportReliable: true,
  agree: [
    point("Mira plans and Jonah builds, and neither wants the other's job.", [quote("I can't start until I know what done looks like.", "a"), quote("Easier to show you than to explain it.", "b")]),
    point("Both would rather demo something small that works than something big that might.", [quote("Ship the boring version first.", "b")]),
    point("Both like a quiet hour before the room fills up.", [quote("I do my best work before anyone else is awake.", "a")]),
  ],
  clash: [
    point("He ships at 3 am. She is done by 9 pm.", [quote("Best code I ever wrote was at 3 am.", "b")]),
    point("He would change the plan halfway; she would want it written down first.", [quote("Plans are a guess with a font.", "b", false)], false),
    point("She would probably go quiet when the pitch gets loud.", [quote("Please don't make me present.", "a")]),
  ],
  decideFirst: [
    point("Who owns the demo, and when the build stops.", [quote("Please don't make me present.", "a"), quote("Give me the mic any day.", "b")]),
    point("One shared list of what done looks like, on day one.", [quote("I can't start until I know what done looks like.", "a")]),
    point("Where you sleep on the last night, and whether you do.", [quote("Sleep is for after the demo.", "b")]),
  ],
};

// One brief view on the brief route with one reply for the brief.
function briefAt(slot: { name: string; title: string; reply: { status: number; body: unknown; delayMs?: number } }): GalleryView {
  return {
    name: slot.name,
    title: slot.title,
    pattern: ROUTE_PATTERNS.brief,
    url: APP_PATHS.brief(IDS.meeting),
    element: <BriefScreen />,
    stubs: [{ route: routes.briefs.readBrief, replies: slot.reply }],
  };
}

// The brief page: ready, a deal's labels, a brief whose check did not run, the quote sheet, still being written, gone, failed.
export const views: readonly GalleryView[] = [
  briefAt({ name: "brief-ready", title: "Brief, getting along", reply: { status: 200, body: SAMPLE } }),
  briefAt({ name: "brief-deal", title: "Brief, a deal's three parts", reply: { status: 200, body: { ...SAMPLE, questionKind: "deal" } } }),
  briefAt({ name: "brief-unchecked", title: "Brief, the support check did not run", reply: { status: 200, body: { ...SAMPLE, supportRate: null, supportReliable: null } } }),
  {
    ...briefAt({ name: "brief-quote", title: "Brief, a quote opened", reply: { status: 200, body: SAMPLE } }),
    play: () => {
      document.querySelector<HTMLButtonElement>(".brief-clash .brief-chip")?.click();
    },
  },
  briefAt({ name: "brief-waiting", title: "Brief, still being written", reply: { status: 409, body: { code: "brief_not_ready", message: "The brief is not written yet." } } }),
  briefAt({ name: "brief-gone", title: "Brief, the meeting is gone", reply: { status: 404, body: { code: "brief_not_found", message: "No brief here." } } }),
  briefAt({ name: "brief-error", title: "Brief, could not be loaded", reply: { status: 500, body: { code: "internal", message: "Something broke." } } }),
];
