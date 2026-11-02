import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PersonCreate, Recover, type PersonCreateResponse } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, readFragmentToken, rememberAllowlist, routes } from "../../app-shell/index.js";
import { rememberAccessCode } from "./access-code.js";

// The message for a display name the contracts refuse (A5).
const NAME_MESSAGE = "Use 1 to 80 characters for your display name.";
// The message for a groups list the contracts refuse [confirm] (drafted copy, no input gives it).
const GROUPS_MESSAGE = "Use at most 10 groups, each 1 to 80 characters.";
// The message for a recovery code of the wrong length [confirm] (drafted copy, no input gives it).
const CODE_MESSAGE = "A recovery code has 32 characters.";
// The message for an access code longer than the contracts allow (R9.5).
const ACCESS_MESSAGE = "An access code has at most 100 characters.";

// Splits the groups field on commas, trims each part and drops empty parts (D17).
export function parseAffiliations(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

// The create flow: idle, sending, created with the code to show once, invalid input, or failed (A5).
export type CreateState = { kind: "idle" } | { kind: "sending" } | { kind: "created"; recoveryCode: string } | { kind: "invalid"; message: string } | { kind: "failed"; error: ApiError };
// The recovery flow: idle, sending, done, invalid input, or failed (A5).
export type RecoverState = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "invalid"; message: string } | { kind: "failed"; error: ApiError };
// The claim flow of /claim: no token, a token ready, sending, done, or failed (R9.2).
export type ClaimState = { kind: "missing" } | { kind: "ready"; token: string } | { kind: "sending"; token: string } | { kind: "done" } | { kind: "failed"; error: ApiError };

// The invalid message for a rejected create body: the name sentence when the name is the cause, the access code sentence when the
// code is, else the groups sentence.
function createMessage(issuePaths: Array<string | number | undefined>): string {
  if (issuePaths.includes("displayName")) return NAME_MESSAGE;
  return issuePaths.includes("accessCode") ? ACCESS_MESSAGE : GROUPS_MESSAGE;
}

// Creates a person and keeps the allowlist in memory; the recovery code lives only in this state (A5, D17). An access code, when
// one was typed or came in the link, goes with the request and is kept for the invite links this person shares (R9.5).
export function useCreatePerson(): { state: CreateState; create: (displayName: string, groups: string, accessCode: string) => Promise<void>; forgetCode: () => void } {
  const [state, setState] = useState<CreateState>({ kind: "idle" });
  const create = async (displayName: string, groups: string, accessCode: string): Promise<void> => {
    const affiliations = parseAffiliations(groups);
    const code = accessCode.trim();
    const body = { displayName, ...(affiliations.length > 0 ? { affiliations } : {}), ...(code !== "" ? { accessCode: code } : {}) };
    const checked = PersonCreate.safeParse(body);
    if (!checked.success) {
      setState({ kind: "invalid", message: createMessage(checked.error.issues.map((issue) => issue.path[0])) });
      return;
    }
    setState({ kind: "sending" });
    try {
      const reply: PersonCreateResponse = await apiFetch(routes.people.createPerson, { body: checked.data });
      rememberAllowlist(checked.data.displayName, checked.data.affiliations ?? []);
      rememberAccessCode(checked.data.accessCode ?? "");
      setState({ kind: "created", recoveryCode: reply.recoveryCode });
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  const forgetCode = (): void => {
    setState({ kind: "idle" });
  };
  return { state, create, forgetCode };
}

// Redeems a recovery code; the server allows it once (A5).
export function useRecover(): { state: RecoverState; recover: (code: string) => Promise<void> } {
  const [state, setState] = useState<RecoverState>({ kind: "idle" });
  const recover = async (code: string): Promise<void> => {
    const checked = Recover.safeParse({ code: code.trim() });
    if (!checked.success) {
      setState({ kind: "invalid", message: CODE_MESSAGE });
      return;
    }
    setState({ kind: "sending" });
    try {
      await apiFetch(routes.people.recover, { body: checked.data });
      setState({ kind: "done" });
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return { state, recover };
}

// Reads the token from the fragment once, removes it from the address bar, and claims it when asked (R9.2).
export function useClaim(): { state: ClaimState; claim: () => Promise<void> } {
  const location = useLocation();
  const navigate = useNavigate();
  const [initialToken] = useState(() => readFragmentToken(location.hash));
  const [state, setState] = useState<ClaimState>(() => (initialToken === null ? { kind: "missing" } : { kind: "ready", token: initialToken }));

  useEffect(() => {
    if (location.hash !== "") navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    // The fragment is read once, when the page opens, so the effect runs once.
  }, []);

  const claim = async (): Promise<void> => {
    if (state.kind !== "ready") return;
    const { token } = state;
    setState({ kind: "sending", token });
    try {
      await apiFetch(routes.people.claim, { body: { token } });
      setState({ kind: "done" });
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return { state, claim };
}
