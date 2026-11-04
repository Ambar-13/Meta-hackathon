import { matchPath, type createBrowserRouter } from "react-router-dom";
import { ROUTE_PATTERNS } from "./app-paths.js";

// Google Analytics for Meety: page views from the live site, each named by its route, and nothing
// else (the property's stream has enhanced measurement off, so no clicks, scrolls or searches).
export const MEASUREMENT_ID = "G-0DLJPMZJV4";
// The one host that loads the tag; a laptop, a test or Render's own address never does.
export const LIVE_HOST = "heymeety.com";
// Where the tag loads from: this site, which serves Google's copy (apps/api/src/web-pages/
// analytics-tag.ts), so the page's Content-Security-Policy allows no other site's script.
export const TAG_URL = "/gtag.js";

// A page as Google sees it: the route's name (a key of ROUTE_PATTERNS) and its pattern.
export type AnalyticsPage = { name: string; path: string };
// What Google is told about one page view.
export type PageViewFields = { page_location: string; page_title: string; page_referrer: string };
// The two settings a browser can send to ask sites not to track it.
export type TrackingSignals = { globalPrivacyControl?: boolean; doNotTrack?: string | null };
// The router parts that page views read: where it is now, and news of each move.
type PageRouter = Pick<ReturnType<typeof createBrowserRouter>, "state" | "subscribe">;
type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

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

// True when this browser may load the tag: on the live host, unless it sends Global Privacy
// Control or Do Not Track.
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

// What one page view tells Google: the pattern's address on this site, the route's name as the
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

// The commands the tag starts with: its clock, then Meety's property with no automatic page view
// (recordPageView sends each one), no Google signals and no ad personalisation.
export function startCommands(now: Date): unknown[][] {
  return [
    ["js", now],
    [
      "config",
      MEASUREMENT_ID,
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    ],
  ];
}

// Loads the tag when this browser allows it, and returns whether it did.
export function startAnalytics(): boolean {
  const signals = navigator as Navigator & TrackingSignals;
  if (!analyticsAllowed(window.location.hostname, signals)) {
    return false;
  }
  const dataLayer = (window.dataLayer ??= []);
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params -- the tag reads each command as an arguments object, not an array
    dataLayer.push(arguments);
  };
  for (const command of startCommands(new Date())) {
    window.gtag(...command);
  }
  const script = document.createElement("script");
  script.async = true;
  script.src = TAG_URL;
  document.head.append(script);
  return true;
}

// Sends one page view for this path, and makes its fields the page of every later event too (such
// as Google's engagement pings), so the real address never goes with them.
export function recordPageView(pathname: string): void {
  const gtag = window.gtag;
  if (gtag === undefined) {
    return;
  }
  const fields = pageViewFields(pathname, window.location.origin, document.referrer);
  gtag("set", fields);
  gtag("event", "page_view", fields);
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
