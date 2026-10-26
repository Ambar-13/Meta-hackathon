import type { Side } from "./app-paths.js";
import { resetServerClock } from "./server-clock.js";

// What this tab remembers: the signup allowlist, the approved card, and the side per meeting. Memory only, never storage.
const session: { allowlist: string[]; approvedCardId: string | null; sides: Map<string, Side> } = {
  allowlist: [],
  approvedCardId: null,
  sides: new Map(),
};

// Keeps the display name and groups typed at signup; the upload screen passes them to prepareUpload as the allowlist (D17, seams S4).
export function rememberAllowlist(displayName: string, affiliations: readonly string[]): void {
  session.allowlist = [displayName, ...affiliations];
}

// The allowlist for prepareUpload: the display name then the groups, or [] after a reload, because it is never stored [confirm].
export function readAllowlist(): string[] {
  return [...session.allowlist];
}

// Keeps the card this tab approved, so the lobby can create a meeting with it.
export function rememberApprovedCard(cardId: string): void {
  session.approvedCardId = cardId;
}

// The card this tab approved, or null.
export function readApprovedCard(): string | null {
  return session.approvedCardId;
}

// Keeps which side this tab is in one meeting, so the lobby can open the meeting with it.
export function rememberViewerSide(meetingId: string, side: Side): void {
  session.sides.set(meetingId, side);
}

// This tab's side in one meeting, or null when it was never chosen here.
export function readViewerSide(meetingId: string): Side | null {
  return session.sides.get(meetingId) ?? null;
}

// The client half of signing out: forgets everything above and the server clock offset; the server clears the cookie itself.
export function clearClientState(): void {
  session.allowlist = [];
  session.approvedCardId = null;
  session.sides.clear();
  resetServerClock();
}
