import { AVATARS, type ComicView } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { ComicScreen } from "../../../screens/comic/index.js";
import { IDS } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { Press } from "./pair.js";

// The comic page's address for the fixture meeting.
const COMIC_URL = APP_PATHS.comic(IDS.meeting);
// The reply of the comic view when no comic was asked for yet.
const NOT_REQUESTED = { status: 404, body: { code: "comic_not_found", message: "No comic has been requested for this meeting." } };
// The first avatar's words, which the picked views tap.
const FIRST_AVATAR = AVATARS[0];
// Six captions in reading order.
const CAPTIONS = [
  "The fox and the owl sit down with a whiteboard.",
  "The owl draws a plan before anyone codes.",
  "The fox is already typing.",
  "They argue, kindly, about what done looks like.",
  "The owl writes it down. The fox nods.",
  "They ship something small that works.",
];
// The ground colour of each drawn panel.
const PANEL_GROUNDS = ["#f7b39b", "#9cc3f5", "#9fe0bf", "#f7ec9a", "#e6c2ec", "#9cc3f5"];

// A simple drawn panel as an SVG data address: a coloured ground with two round figures, so the frames show a picture.
function panelImage(index: number): string {
  const ground = PANEL_GROUNDS[index] ?? "#9cc3f5";
  const shift = String(index * 18);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${ground}"/><circle cx="${String(30 + index * 2)}" cy="58" r="16" fill="#e2603f" stroke="#1c2340" stroke-width="2"/><circle cx="${String(70 - index * 2)}" cy="60" r="14" fill="#4a7de0" stroke="#1c2340" stroke-width="2"/><rect x="${shift}" y="84" width="40" height="6" rx="3" fill="#1c2340" opacity="0.2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// A comic view in one state; ready carries six drawn panels, and a broken one has a panel whose image does not load.
function comicIn(state: ComicView["state"], hasBrokenPanel = false): ComicView {
  if (state !== "ready") return { state, panels: [] };
  return {
    state,
    panels: CAPTIONS.map((caption, index) => ({
      position: index + 1,
      caption,
      imageUrl: hasBrokenPanel && index === 3 ? "/api/comics/missing.png" : panelImage(index),
    })),
  };
}

// The stub of the comic view with one reply.
function readComic(reply: { status: number; body: unknown; delayMs?: number }): GalleryStub {
  return { route: routes.briefs.readComic, replies: reply };
}

// One comic view on the comic route.
function comic(name: string, title: string, stubs: readonly GalleryStub[]): GalleryView {
  return { name, title, pattern: ROUTE_PATTERNS.comic, url: COMIC_URL, element: <ComicScreen />, stubs };
}

// The comic page: loading, error, the avatar picker, waiting for the brief, drawing, the finished strip, a broken panel, and not drawn.
export const views: readonly GalleryView[] = [
  comic("comic-loading", "Comic, loading", [readComic({ status: 200, body: comicIn("rendering"), delayMs: FOREVER_MS })]),
  comic("comic-error", "Comic, the comic could not be read", [readComic({ status: 500, body: { code: "server_error", message: "Something went wrong on our side. Try again in a minute." } })]),
  comic("comic-pick", "Comic, the avatar picker", [readComic(NOT_REQUESTED)]),
  {
    name: "comic-picked",
    title: "Comic, an avatar picked",
    pattern: ROUTE_PATTERNS.comic,
    url: COMIC_URL,
    element: (
      <Press steps={[FIRST_AVATAR]}>
        <ComicScreen />
      </Press>
    ),
    stubs: [readComic(NOT_REQUESTED)],
  },
  {
    name: "comic-brief-not-ready",
    title: "Comic, the brief comes first",
    pattern: ROUTE_PATTERNS.comic,
    url: COMIC_URL,
    element: (
      <Press steps={[FIRST_AVATAR, "Draw the comic"]}>
        <ComicScreen />
      </Press>
    ),
    stubs: [
      readComic(NOT_REQUESTED),
      { route: routes.briefs.requestComic, replies: { status: 409, body: { code: "brief_not_ready", message: "The brief is not written yet. The comic comes after the brief." } } },
    ],
  },
  comic("comic-drawing", "Comic, drawing", [readComic({ status: 200, body: comicIn("rendering") })]),
  comic("comic-ready", "Comic, the finished strip", [readComic({ status: 200, body: comicIn("ready") })]),
  comic("comic-broken-panel", "Comic, one panel did not load", [readComic({ status: 200, body: comicIn("ready", true) })]),
  comic("comic-failed", "Comic, the drawing failed", [readComic({ status: 200, body: comicIn("failed") })]),
  comic("comic-skipped", "Comic, not drawn", [readComic({ status: 200, body: comicIn("skipped") })]),
];
