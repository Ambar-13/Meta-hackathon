// The paths the browser app has a screen for, as patterns whose :name parts stand for an id or a
// slug. apps/web builds its route table from the same list (ROUTE_PATTERNS in app-paths.ts, kept
// equal by a test there), so the api can tell a page of the app from an address nobody has, which
// answers 404 instead of the app shell.
export const CLIENT_PATH_PATTERNS: readonly string[] = [
  "/",
  "/upload",
  "/pair",
  "/join",
  "/claim",
  "/settings",
  "/sources/:sourceId/names",
  "/cards/:cardId",
  "/quizzes/:quizId",
  "/pairs/:pairId",
  "/meetings/:meetingId",
  "/meetings/:meetingId/brief",
  "/meetings/:meetingId/comic",
  "/meetings/:meetingId/share",
  "/share/:slug",
  "/directory",
  "/help",
  "/friends",
  "/asks/:askId",
  "/home",
  "/explore",
  "/me",
  "/people/:listingId",
  "/meety",
  "/search",
  "/create",
  "/privacy",
  "/terms",
  "/cookies",
];

// One page anyone may read without signing in: its path, the file apps/web/prerender.ts writes
// under dist/prerendered with the page's words already in the HTML, and the day those words last
// changed, which the sitemap reports.
export type PublicPage = { path: string; file: string; changed: string };

// The public pages, in the order the sitemap lists them. Move a page's day only when its words
// change, never otherwise: search engines treat a moving date with unchanged words as a warning sign.
export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: "/", file: "index.html", changed: "2026-11-05" },
  { path: "/privacy", file: "privacy.html", changed: "2026-11-05" },
  { path: "/terms", file: "terms.html", changed: "2026-11-03" },
  { path: "/cookies", file: "cookies.html", changed: "2026-11-05" },
];

// The start of every public share page's path. Anyone with the link may read one, so they are
// not kept out of search results, and none is in the sitemap.
export const SHARE_PATH_PREFIX = "/share/";

// The path of a request url: what comes before "?" or "#", with one trailing slash dropped, so
// /privacy/ and /privacy name the same page.
export function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

// The parts of a path after its leading slash: "/" gives [""], "/a/b" gives ["a", "b"].
function partsOf(path: string): string[] {
  return path.split("/").slice(1);
}

// True when the parts of a path fit a pattern's parts: the same count, and each part equal to the
// pattern's or standing where the pattern has a :name part.
function fitsPattern(pattern: string, parts: readonly string[]): boolean {
  const patternParts = partsOf(pattern);
  return (
    patternParts.length === parts.length &&
    patternParts.every((part, index) =>
      part.startsWith(":") ? parts[index] !== "" : part === parts[index],
    )
  );
}

// True when a path (as pathOf gives it) is one of the browser app's pages.
export function isClientPath(pathname: string): boolean {
  const parts = partsOf(pathname);
  return CLIENT_PATH_PATTERNS.some((pattern) => fitsPattern(pattern, parts));
}

// True when the page at a path may appear in search results: a public page or a share page. Every
// other page shows nothing without a session, so the api marks its shell noindex.
export function isIndexablePath(pathname: string): boolean {
  return (
    PUBLIC_PAGES.some((page) => page.path === pathname) || pathname.startsWith(SHARE_PATH_PREFIX)
  );
}
