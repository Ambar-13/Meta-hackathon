import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import qrcode from "qrcode-generator";
import type { PairCreateResponse } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, readFragmentToken, routes } from "../../app-shell/index.js";

// The QR error correction level.
export const QR_ERROR_CORRECTION = "M";
// The quiet margin around the QR code, in modules.
export const QR_MARGIN_MODULES = 2;

// Making an invite: idle, sending, created, or failed.
export type CreatePairState = { kind: "idle" } | { kind: "sending" } | { kind: "created"; pair: PairCreateResponse } | { kind: "failed"; error: ApiError };
// Joining from an invite link: no token, ready, sending, needs a profile first, joined, or failed.
export type JoinState = { kind: "missing" } | { kind: "ready"; token: string } | { kind: "sending"; token: string } | { kind: "needs_profile"; token: string } | { kind: "joined"; pairId: string } | { kind: "failed"; error: ApiError };

// The dark modules of a link's QR code as one SVG path, and the side of its square viewBox.
export function qrPathFor(url: string): { path: string; size: number } {
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) parts.push(`M${String(col + QR_MARGIN_MODULES)} ${String(row + QR_MARGIN_MODULES)}h1v1h-1z`);
    }
  }
  return { path: parts.join(""), size: count + 2 * QR_MARGIN_MODULES };
}

// Makes one invite on request.
export function useCreatePair(): { state: CreatePairState; create: () => Promise<void> } {
  const [state, setState] = useState<CreatePairState>({ kind: "idle" });
  const create = async (): Promise<void> => {
    setState({ kind: "sending" });
    try {
      const pair = await apiFetch(routes.meetings.createPair);
      setState({ kind: "created", pair });
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return { state, create };
}

// Joining from an invite link: reads the token from the fragment once, removes it from the address bar, joins on request, and asks for a profile on a 401.
export function useJoinPair(): { state: JoinState; join: () => Promise<void>; profileCreated: () => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const [initialToken] = useState(() => readFragmentToken(location.hash));
  const [state, setState] = useState<JoinState>(() => (initialToken === null ? { kind: "missing" } : { kind: "ready", token: initialToken }));

  useEffect(() => {
    if (location.hash !== "") navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    // The fragment is read once, when the page opens, so the effect runs once.
  }, []);

  const joinWith = async (token: string): Promise<void> => {
    setState({ kind: "sending", token });
    try {
      const reply = await apiFetch(routes.meetings.joinPair, { body: { token } });
      setState({ kind: "joined", pairId: reply.pairId });
    } catch (thrown: unknown) {
      const error = asApiError(thrown);
      setState(error.status === 401 ? { kind: "needs_profile", token } : { kind: "failed", error });
    }
  };

  const join = async (): Promise<void> => {
    if (state.kind !== "ready") return;
    await joinWith(state.token);
  };

  const profileCreated = (): void => {
    if (state.kind !== "needs_profile") return;
    void joinWith(state.token);
  };

  return { state, join, profileCreated };
}
