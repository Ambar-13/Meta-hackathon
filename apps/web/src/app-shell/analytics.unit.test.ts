import { expect, it } from "vitest";
import {
  analyticsAllowed,
  MEASUREMENT_ID,
  pageForPath,
  pageViewFields,
  startCommands,
  TAG_URL,
} from "./analytics.js";

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

it("W7-ANALYTICS-T2: the tag loads only on heymeety.com, and never when the browser sends Global Privacy Control or Do Not Track", () => {
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

it("W7-ANALYTICS-T4: the tag loads from Meety's own address and starts with no automatic page view, no Google signals and no ad personalisation", () => {
  const now = new Date(0);
  expect(TAG_URL).toBe("/gtag.js");
  expect(startCommands(now)).toEqual([
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
  ]);
});
