import { describe, expect, it, vi } from "vitest";
import { reconnectDelayMs, watchVisibility, type VisibilitySource } from "./reconnect-schedule.js";

// A fake document that the test can flip between hidden and visible.
function fakeDocument(): VisibilitySource & { dispatch: (state: string) => void } {
  let listener: (() => void) | null = null;
  const document = {
    visibilityState: "visible",
    addEventListener: (kind: "visibilitychange", next: () => void) => {
      listener = next;
    },
    removeEventListener: () => {
      listener = null;
    },
    dispatch: (state: string) => {
      document.visibilityState = state;
      listener?.();
    },
  };
  return document;
}

describe("reconnect schedule", () => {
  it("D51-T1: the backoff is 1, 2, 4, 8, 16, 30 and 30 s before jitter", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, () => 0))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("R8.4-T2: jitter keeps every wait between 80% and 100% of its base, so reconnects spread out", () => {
    const base = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, () => 0.5))).toEqual([
      900, 1800, 3600, 7200, 14400, 27000, 27000,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, () => 1))).toEqual([
      800, 1600, 3200, 6400, 12800, 24000, 24000,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, () => 5))).toEqual([
      800, 1600, 3200, 6400, 12800, 24000, 24000,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelayMs(attempt, () => -1))).toEqual(
      base,
    );
  });

  it("D51-T2: watchVisibility calls back when the page turns visible and not when it hides, using a fake document", () => {
    const document = fakeDocument();
    const callback = vi.fn();
    const stop = watchVisibility(document, callback);
    document.dispatch("hidden");
    document.dispatch("visible");
    stop();
    document.dispatch("visible");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(typeof watchVisibility(null, callback)).toBe("function");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
