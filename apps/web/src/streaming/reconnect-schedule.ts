import { RECONNECT } from "@meet-first/contracts";

// How much shorter than the base delay a reconnect may be, at random, so many phones do not
// reconnect at the same moment (golden-path.md uses jitter up to 20%).
export const JITTER_FRACTION = 0.2;

// The wait before reconnect number attempt (0 first): RECONNECT.firstMs doubled per attempt, capped
// at RECONNECT.capMs, then cut by up to 20% at random.
export function reconnectDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(
    RECONNECT.capMs,
    RECONNECT.firstMs * RECONNECT.factor ** Math.max(0, Math.floor(attempt)),
  );
  const jitter = Math.min(1, Math.max(0, random()));
  return Math.round(base * (1 - JITTER_FRACTION * jitter));
}

// The part of a document the visibility watcher uses, so a test can pass a fake one.
export type VisibilitySource = {
  readonly visibilityState: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

// Calls onVisible each time the page turns visible again, so a phone back from the background
// reconnects at once; returns the stop function.
export function watchVisibility(
  source: VisibilitySource | null,
  onVisible: () => void,
): () => void {
  if (source === null) return () => undefined;
  const listener = (): void => {
    if (source.visibilityState === "visible") onVisible();
  };
  source.addEventListener("visibilitychange", listener);
  return () => {
    source.removeEventListener("visibilitychange", listener);
  };
}
