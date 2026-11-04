import { beforeEach, describe, expect, it } from "vitest";
import {
  clearClientState,
  readAllowlist,
  readApprovedCard,
  readViewerSide,
  rememberAllowlist,
  rememberApprovedCard,
  rememberViewerSide,
} from "./browser-session.js";
import { serverOffsetMs, setServerOffsetOnce, resetServerClock } from "./server-clock.js";
import { IDS } from "../testing/fixtures.js";

describe("browser session", () => {
  beforeEach(() => {
    clearClientState();
    resetServerClock();
  });

  it("D17-T1: readAllowlist returns the display name then the groups, as a copy", () => {
    rememberAllowlist("Priya", ["robotics club"]);
    const first = readAllowlist();
    expect(first).toEqual(["Priya", "robotics club"]);
    first.push("x");
    expect(readAllowlist()).toEqual(["Priya", "robotics club"]);
  });

  it("A8-T2: the viewer side is kept per meeting", () => {
    rememberViewerSide(IDS.meeting, "b");
    expect(readViewerSide(IDS.meeting)).toBe("b");
    expect(readViewerSide(IDS.pair)).toBeNull();
  });

  it("A7-T5: clearClientState forgets the allowlist, the approved card, every side and the server offset", () => {
    rememberAllowlist("Priya", ["robotics club"]);
    rememberApprovedCard(IDS.card);
    rememberViewerSide(IDS.meeting, "a");
    setServerOffsetOnce("2026-10-27T10:00:00.000Z", Date.parse("2026-10-27T10:05:00.000Z"));
    clearClientState();
    expect(readAllowlist()).toEqual([]);
    expect(readApprovedCard()).toBeNull();
    expect(readViewerSide(IDS.meeting)).toBeNull();
    expect(serverOffsetMs()).toBeNull();
  });
});
