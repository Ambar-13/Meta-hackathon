import { beforeEach, describe, expect, it } from "vitest";
import {
  elapsedSeconds,
  nowOnServerMs,
  resetServerClock,
  secondsUntil,
  serverOffsetMs,
  setServerOffsetOnce,
} from "./server-clock.js";

describe("server clock", () => {
  beforeEach(() => {
    resetServerClock();
  });

  it("R12.2-T2: the countdown uses one serverNow offset, so a phone clock 5 minutes ahead still shows 90 seconds", () => {
    setServerOffsetOnce("2026-10-27T10:00:00.000Z", Date.parse("2026-10-27T10:05:00.000Z"));
    const seconds = secondsUntil(
      "2026-10-27T10:01:30.000Z",
      Date.parse("2026-10-27T10:05:00.000Z"),
    );
    setServerOffsetOnce("2026-10-27T12:00:00.000Z", Date.parse("2026-10-27T10:05:00.000Z"));
    expect(seconds).toBe(90);
    expect(serverOffsetMs()).toBe(-300000);
  });

  it("R12.2-T3: secondsUntil rounds up and never goes below 0", () => {
    setServerOffsetOnce("2026-10-27T10:00:00.000Z", Date.parse("2026-10-27T10:00:00.000Z"));
    expect(secondsUntil("2026-10-27T10:01:29.400Z", Date.parse("2026-10-27T10:00:00.000Z"))).toBe(
      90,
    );
    expect(secondsUntil("2026-10-27T09:59:55.000Z", Date.parse("2026-10-27T10:00:00.000Z"))).toBe(
      0,
    );
  });

  it("R12.2-T4: before any reply the server time is the phone time", () => {
    expect(serverOffsetMs()).toBeNull();
    expect(nowOnServerMs(123456)).toBe(123456);
  });

  it("R3.4-T1: elapsedSeconds counts between two serverNow values and never goes below 0", () => {
    expect(elapsedSeconds("2026-10-27T10:00:00.000Z", "2026-10-27T10:00:07.900Z")).toBe(7);
    expect(elapsedSeconds("2026-10-27T10:00:07.900Z", "2026-10-27T10:00:00.000Z")).toBe(0);
  });
});
