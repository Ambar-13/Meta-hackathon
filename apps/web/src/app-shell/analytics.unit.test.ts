import { afterEach, expect, it, vi } from "vitest";
import {
  analyticsAllowed,
  COLLECT_URL,
  hitQuery,
  MEASUREMENT_ID,
  nextVisitor,
  pageForPath,
  pageViewFields,
  recordPageView,
  VISIT_GAP_MS,
  VISITOR_KEY,
  type TrackingSignals,
  type Visitor,
} from "./analytics.js";

const FIRST_PAGE: Visitor = { id: "7.100", visitId: 100, visits: 1, lastPageAt: 100_000, pages: 1 };

// A stand-in browser on this host: its notes and the requests it sent.
function stubBrowser(
  hostname: string,
  signals: TrackingSignals = {},
): { sent: { url: string; init: RequestInit }[]; notes: Map<string, string> } {
  const sent: { url: string; init: RequestInit }[] = [];
  const notes = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { hostname, origin: `https://${hostname}` },
    localStorage: {
      getItem: (key: string) => notes.get(key) ?? null,
      setItem: (key: string, value: string) => notes.set(key, value),
    },
  });
  vi.stubGlobal("navigator", signals);
  vi.stubGlobal("document", { referrer: "https://www.google.com/search?q=meety" });
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(new Response());
  });
  return { sent, notes };
}

// The address of one request the stand-in browser sent.
function sentUrl(sent: { url: string }[], index: number): URL {
  const hit = sent[index];
  if (hit === undefined) {
    throw new Error(`no request ${String(index)}`);
  }
  return new URL(hit.url);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("W7-ANALYTICS-T1: a path becomes its route's name and pattern, so no id, slug or unknown path reaches Google", () => {
  expect(pageForPath("/")).toEqual({ name: "welcome", path: "/" });
  expect(pageForPath("/people/2f0c6a8e-6c3b-4d6e-9d7f-0a1b2c3d4e5f")).toEqual({
    name: "person",
    path: "/people/:listingId",
  });
  expect(pageForPath("/meetings/7/brief")).toEqual({
    name: "brief",
    path: "/meetings/:meetingId/brief",
  });
  expect(pageForPath("/share/k3y-only-the-link-holder-knows")).toEqual({
    name: "sharePage",
    path: "/share/:slug",
  });
  expect(pageForPath("/somewhere/else")).toEqual({ name: "notFound", path: "/not-found" });
});

it("W7-ANALYTICS-T2: page views go only from heymeety.com, and never when the browser sends Global Privacy Control or Do Not Track", () => {
  expect(analyticsAllowed("heymeety.com", {})).toBe(true);
  expect(analyticsAllowed("heymeety.com", { globalPrivacyControl: false, doNotTrack: "0" })).toBe(
    true,
  );
  expect(analyticsAllowed("localhost", {})).toBe(false);
  expect(analyticsAllowed("meet-first.onrender.com", {})).toBe(false);
  expect(analyticsAllowed("heymeety.com", { globalPrivacyControl: true })).toBe(false);
  expect(analyticsAllowed("heymeety.com", { doNotTrack: "1" })).toBe(false);
});

it("W7-ANALYTICS-T3: a page view carries the pattern's address and name and the referrer's site only, never the query, the # part or the referrer's path", () => {
  expect(
    pageViewFields("/join", "https://heymeety.com", "https://www.google.com/search?q=meety"),
  ).toEqual({
    page_location: "https://heymeety.com/join",
    page_title: "join",
    page_referrer: "https://www.google.com/",
  });
  expect(pageViewFields("/meety", "https://heymeety.com", "")).toEqual({
    page_location: "https://heymeety.com/meety",
    page_title: "meety",
    page_referrer: "",
  });
  expect(pageViewFields("/cards/9", "https://heymeety.com", "not a url").page_referrer).toBe("");
});

it("W7-ANALYTICS-T4: a first page starts a visitor, a page within half an hour joins the visit, and a longer gap starts a new visit for the same visitor", () => {
  expect(nextVisitor(null, 100_000, "7.100")).toEqual(FIRST_PAGE);
  expect(nextVisitor(FIRST_PAGE, 100_000 + VISIT_GAP_MS - 1, "ignored")).toEqual({
    ...FIRST_PAGE,
    lastPageAt: 100_000 + VISIT_GAP_MS - 1,
    pages: 2,
  });
  expect(nextVisitor(FIRST_PAGE, 100_000 + VISIT_GAP_MS, "ignored")).toEqual({
    id: "7.100",
    visitId: 1_900,
    visits: 2,
    lastPageAt: 100_000 + VISIT_GAP_MS,
    pages: 1,
  });
});

it("W7-ANALYTICS-T5: a hit carries exactly these fields and no others, and marks a first visit and a new visit", () => {
  const fields = pageViewFields("/people/1", "https://heymeety.com", "https://www.google.com/x");
  const first = Object.fromEntries(new URLSearchParams(hitQuery(fields, FIRST_PAGE)));
  const later = Object.fromEntries(
    new URLSearchParams(
      hitQuery(pageViewFields("/home", "https://heymeety.com", ""), {
        ...FIRST_PAGE,
        visits: 2,
        pages: 3,
      }),
    ),
  );
  const newVisit = Object.fromEntries(
    new URLSearchParams(hitQuery(fields, { ...FIRST_PAGE, visits: 2 })),
  );

  expect(first).toEqual({
    v: "2",
    tid: MEASUREMENT_ID,
    cid: "7.100",
    sid: "100",
    sct: "1",
    seg: "0",
    npa: "1",
    en: "page_view",
    dl: "https://heymeety.com/people/:listingId",
    dt: "person",
    dr: "https://www.google.com/",
    _ss: "1",
    _nsi: "1",
    _fv: "1",
  });
  expect(later).toEqual({
    v: "2",
    tid: MEASUREMENT_ID,
    cid: "7.100",
    sid: "100",
    sct: "2",
    seg: "1",
    npa: "1",
    en: "page_view",
    dl: "https://heymeety.com/home",
    dt: "home",
  });
  expect([newVisit._ss, newVisit._nsi, newVisit._fv]).toEqual(["1", "1", undefined]);
});

it("W7-ANALYTICS-T6: on heymeety.com each page sends one hit with no cookies and no referrer, and the visitor carries over in its note", () => {
  const { sent, notes } = stubBrowser("heymeety.com");

  recordPageView("/share/k3y-only-the-link-holder-knows");
  recordPageView("/home");

  expect(sent).toHaveLength(2);
  const first = sentUrl(sent, 0);
  const second = sentUrl(sent, 1);
  expect(first.origin + first.pathname).toBe(COLLECT_URL);
  expect(first.searchParams.get("dl")).toBe("https://heymeety.com/share/:slug");
  expect(first.href).not.toContain("k3y-only-the-link-holder-knows");
  expect(sent[0]?.init).toEqual({
    method: "POST",
    mode: "no-cors",
    keepalive: true,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  expect(second.searchParams.get("cid")).toBe(first.searchParams.get("cid"));
  expect(second.searchParams.get("_ss")).toBeNull();
  expect(second.searchParams.get("seg")).toBe("1");
  expect(notes.has(VISITOR_KEY)).toBe(true);
});

it("W7-ANALYTICS-T7: another host, Global Privacy Control and Do Not Track send nothing and keep no note", () => {
  const cases: [string, TrackingSignals][] = [
    ["localhost", {}],
    ["meet-first.onrender.com", {}],
    ["heymeety.com", { globalPrivacyControl: true }],
    ["heymeety.com", { doNotTrack: "1" }],
  ];
  for (const [hostname, signals] of cases) {
    const { sent, notes } = stubBrowser(hostname, signals);

    recordPageView("/home");

    expect(sent).toEqual([]);
    expect(notes.size).toBe(0);
  }
});

it("W7-ANALYTICS-T8: a note that cannot be read starts a new visitor, and a browser that keeps nothing still counts the page", () => {
  const { sent, notes } = stubBrowser("heymeety.com");
  notes.set(VISITOR_KEY, "not json");
  recordPageView("/home");
  expect(sentUrl(sent, 0).searchParams.get("_fv")).toBe("1");

  vi.stubGlobal("window", {
    location: { hostname: "heymeety.com", origin: "https://heymeety.com" },
    get localStorage(): Storage {
      throw new Error("storage is off");
    },
  });
  recordPageView("/home");
  expect(sent).toHaveLength(2);
});
