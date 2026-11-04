import { matchPath, type createBrowserRouter } from "react-router-dom";
import { z } from "zod";
import { ROUTE_PATTERNS } from "./app-paths.js";

// Google Analytics for Meety: one hit per page, built here field by field, and nothing else. Meety
// sends the hits itself and loads no Google script, because Google's tag also sends the page's real
// address on its own, and this app's addresses can carry a draft, an invite token or the access code.
export const MEASUREMENT_ID = "G-0DLJPMZJV4";
// Where the hits go, the one host the live site's Content-Security-Policy lets them reach.
export const COLLECT_URL = "https://www.google-analytics.com/g/collect";
// The one host that sends hits; a laptop, a test or Render's own address never does.
export const LIVE_HOST = "heymeety.com";
// The browser note that keeps the visitor between pages, listed on the cookies page.
export const VISITOR_KEY = "meet-first.visitor";
// A visit ends after half an hour with no new page, as Google Analytics counts sessions.
export const VISIT_GAP_MS = 1_800_000;

// A page as Google sees it: the route's name (a key of ROUTE_PATTERNS) and its pattern.
export type AnalyticsPage = { name: string; path: string };
// What Google is told about one page.
export type PageViewFields = { page_location: string; page_title: string; page_referrer: string };
// The two settings a browser can send to ask sites not to track it.
export type TrackingSignals = { globalPrivacyControl?: boolean; doNotTrack?: string | null };
// The router parts that page views read: where it is now, and news of each move.
type PageRouter = Pick<ReturnType<typeof createBrowserRouter>, "state" | "subscribe">;

// What the note keeps: a random number for this browser, the visit it is on (the second that visit
// began), how many visits it has made, when it last opened a page, and the pages of this visit.
const Visitor = z.object({
  id: z.string(),
  visitId: z.number(),
  visits: z.number(),
  lastPageAt: z.number(),
  pages: z.number(),
});
export type Visitor = z.infer<typeof Visitor>;

// The route a path matches, as its name and pattern, so ids, slugs and tokens stay in the browser.
// Example: "/people/2f0c…" gives { name: "person", path: "/people/:listingId" }; a path no route
// matches gives { name: "notFound", path: "/not-found" }.
export function pageForPath(pathname: string): AnalyticsPage {
  for (const [name, path] of Object.entries(ROUTE_PATTERNS)) {
    if (matchPath(path, pathname) !== null) {
      return { name, path };
    }
  }
  return { name: "notFound", path: "/not-found" };
}

// True when this browser may send hits: on the live host, unless it sends Global Privacy Control
// or Do Not Track.
export function analyticsAllowed(hostname: string, signals: TrackingSignals): boolean {
  return (
    hostname === LIVE_HOST && signals.globalPrivacyControl !== true && signals.doNotTrack !== "1"
  );
}

// The site a referrer came from, such as "https://www.google.com/", or "" for none; its path and
// query stay out, because they can carry another site's search words.
function referrerSite(referrer: string): string {
  try {
    const origin = new URL(referrer).origin;
    return origin === "null" ? "" : `${origin}/`;
  } catch {
    return "";
  }
}

// What one hit says about its page: the pattern's address on this site, the route's name as the
// title, and the referrer's site. The query and the # part never go, so drafts, invite tokens and
// the access code stay in the browser.
export function pageViewFields(pathname: string, origin: string, referrer: string): PageViewFields {
  const page = pageForPath(pathname);
  return {
    page_location: origin + page.path,
    page_title: page.name,
    page_referrer: referrerSite(referrer),
  };
}

// The visitor after one more page: a first page starts the visitor with this id, a page within
// VISIT_GAP_MS joins the visit, and a longer gap starts a new visit for the same visitor.
export function nextVisitor(stored: Visitor | null, nowMs: number, newId: string): Visitor {
  const visitId = Math.floor(nowMs / 1000);
  if (stored === null) {
    return { id: newId, visitId, visits: 1, lastPageAt: nowMs, pages: 1 };
  }
  if (nowMs - stored.lastPageAt >= VISIT_GAP_MS) {
    return { ...stored, visitId, visits: stored.visits + 1, lastPageAt: nowMs, pages: 1 };
  }
  return { ...stored, lastPageAt: nowMs, pages: stored.pages + 1 };
}

// Everything one hit sends, in Google Analytics' own field names: the property, the visitor and its
// visit, whether the visit has gone past one page, no ad personalisation, and the page. A visit's
// first page and a visitor's first page each say so, which Google counts as a session and a user.
export function hitQuery(fields: PageViewFields, visitor: Visitor): string {
  const query = new URLSearchParams({
    v: "2",
    tid: MEASUREMENT_ID,
    cid: visitor.id,
    sid: String(visitor.visitId),
    sct: String(visitor.visits),
    seg: visitor.pages > 1 ? "1" : "0",
    npa: "1",
    en: "page_view",
    dl: fields.page_location,
    dt: fields.page_title,
  });
  if (fields.page_referrer !== "") {
    query.set("dr", fields.page_referrer);
  }
  if (visitor.pages === 1) {
    query.set("_ss", "1");
    query.set("_nsi", "1");
  }
  if (visitor.pages === 1 && visitor.visits === 1) {
    query.set("_fv", "1");
  }
  return query.toString();
}

// The visitor in this browser's note, or null when there is none or it cannot be read.
function readVisitor(): Visitor | null {
  try {
    const parsed = Visitor.safeParse(
      JSON.parse(window.localStorage.getItem(VISITOR_KEY) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Keeps the visitor in the note.
function rememberVisitor(visitor: Visitor): void {
  try {
    window.localStorage.setItem(VISITOR_KEY, JSON.stringify(visitor));
  } catch {
    // A browser that keeps nothing counts each page as a new visitor; nothing else changes.
  }
}

// A new visitor's number, in Google's form of a random number and the second it was made.
function newVisitorId(nowMs: number): string {
  const [random = 0] = crypto.getRandomValues(new Uint32Array(1));
  return `${String(random)}.${String(Math.floor(nowMs / 1000))}`;
}

// Sends one hit for this path when this browser allows it. The request carries no cookies and no
// referrer, so the query below is all Google is told, beyond what any request shows.
export function recordPageView(pathname: string): void {
  const signals = navigator as Navigator & TrackingSignals;
  if (!analyticsAllowed(window.location.hostname, signals)) {
    return;
  }
  const nowMs = Date.now();
  const visitor = nextVisitor(readVisitor(), nowMs, newVisitorId(nowMs));
  rememberVisitor(visitor);
  const fields = pageViewFields(pathname, window.location.origin, document.referrer);
  void fetch(`${COLLECT_URL}?${hitQuery(fields, visitor)}`, {
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).catch(() => {
    // A blocked or failed hit costs one count and nothing else.
  });
}

// Records the router's page now and after every move to another path; returns the unsubscribe.
export function recordPageViews(router: PageRouter): () => void {
  let lastPath = router.state.location.pathname;
  recordPageView(lastPath);
  return router.subscribe((state) => {
    if (state.location.pathname === lastPath) {
      return;
    }
    lastPath = state.location.pathname;
    recordPageView(lastPath);
  });
}
