import type { SourceView } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { NamesReviewScreen } from "../../../screens/names-review/index.js";
import { IDS, sourceView } from "../../fixtures.js";
import { FOREVER_MS, type GalleryReply } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// First names for the rows, so the gallery reads like a real export instead of "Name 1".
const FIRST_NAMES = [
  "Priya",
  "Daniel",
  "Ama",
  "Jonah",
  "Wei",
  "Sofia",
  "Kofi",
  "Lena",
  "Arjun",
  "Maya",
  "Tomas",
  "Hana",
  "Ravi",
  "Zoe",
  "Omar",
  "Ines",
  "Felix",
  "Noor",
  "Sam",
  "Yuki",
  "Ezra",
  "Lila",
  "Marco",
  "Aisha",
];
// What each role says the name was seen as, in the same order the fixture gives the roles.
const CONTEXTS: Record<string, string> = {
  "[person:friend]": "dinner with [person:friend] on Friday",
  "[person:manager]": "[person:manager] wants the deck by Monday",
};

// One page of a source with `total` names, the rows given real first names; the check is done
// unless isLooking.
function namesView(page: number, total: number, isLooking = false): SourceView {
  const base = sourceView(page, total);
  const rows = base.names.rows.map((row, index) => {
    const name = FIRST_NAMES[((page - 1) * 20 + index) % FIRST_NAMES.length] ?? row.text;
    return { ...row, text: name, context: CONTEXTS[row.roleToken] ?? row.context };
  });
  return { ...base, namesPassDone: !isLooking, names: { ...base.names, rows } };
}

// One names view on the names route of the fixture source, with the replies the source read gives.
function namesGalleryView(
  name: string,
  title: string,
  replies: GalleryReply | GalleryReply[],
): GalleryView {
  return {
    name,
    title,
    pattern: ROUTE_PATTERNS.namesReview,
    url: APP_PATHS.namesReview(IDS.source),
    element: <NamesReviewScreen />,
    stubs: [{ route: routes.sources.readSource, replies }],
  };
}

// Every state of the names check: looking, failed, found (with the check still running, many pages,
// none), and already reviewed.
export const views: readonly GalleryView[] = [
  namesGalleryView("names-looking", "Names check, looking for names", {
    status: 200,
    body: namesView(1, 5),
    delayMs: FOREVER_MS,
  }),
  namesGalleryView("names-failed", "Names check, the names did not load", {
    status: 503,
    body: null,
  }),
  namesGalleryView("names-found", "Names check, the list of names found", {
    status: 200,
    body: namesView(1, 5),
  }),
  namesGalleryView("names-found-still-looking", "Names check, names so far while the check runs", {
    status: 200,
    body: namesView(1, 3, true),
  }),
  namesGalleryView("names-found-pages", "Names check, more names than one page", {
    status: 200,
    body: namesView(1, 24),
  }),
  namesGalleryView("names-empty", "Names check, no names found", {
    status: 200,
    body: namesView(1, 0),
  }),
  namesGalleryView("names-reviewed", "Names check, a source already reviewed", {
    status: 200,
    body: {
      ...namesView(1, 5),
      frozenAt: "2026-10-27T09:00:00.000Z",
      namesReviewedAt: "2026-10-27T09:00:00.000Z",
    },
  }),
];
