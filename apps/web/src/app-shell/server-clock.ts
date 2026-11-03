// The offset from the phone clock to the server clock in milliseconds, or null before any reply has set it.
let offsetMs: number | null = null;

// Sets the offset (server time minus phone time) from a serverNow and the phone time it arrived, the first time only.
export function setServerOffsetOnce(serverNow: string, receivedAtMs: number): void {
  if (offsetMs !== null) return;
  const serverMs = Date.parse(serverNow);
  if (Number.isNaN(serverMs)) return;
  offsetMs = serverMs - receivedAtMs;
}

// The offset in milliseconds, or null before any reply has set it.
export function serverOffsetMs(): number | null {
  return offsetMs;
}

// The server's time now: the phone's clock plus the one offset, or plus 0 before it is set.
export function nowOnServerMs(localNowMs: number = Date.now()): number {
  return localNowMs + (offsetMs ?? 0);
}

// Whole seconds until an ISO time on the server's clock, rounded up and never below 0; the countdown shows it.
export function secondsUntil(isoTime: string, localNowMs: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(isoTime) - nowOnServerMs(localNowMs)) / 1000));
}

// Whole seconds from one serverNow to a later one, rounded down and never below 0; the card screen shows it.
export function elapsedSeconds(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
}

// Forgets the offset; the client sign-out and the tests call it.
export function resetServerClock(): void {
  offsetMs = null;
}
