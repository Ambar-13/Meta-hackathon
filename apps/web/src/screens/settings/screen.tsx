// The settings screen until the deletion builder replaces this folder in Wave 2; it already holds the "open in Safari" link (seams S11, R9.2).
import { useState, type ReactElement } from "react";
import { type TransferResponse } from "@meet-first/contracts";
import { apiFetch, asApiError, ApiError, CopyButton, ErrorNotice, ScreenFrame, routes } from "../../app-shell/index.js";

// The transfer link state: idle, sending, created with the link, or failed.
type TransferState = { kind: "idle" } | { kind: "sending" } | { kind: "created"; url: string } | { kind: "failed"; error: ApiError };

// The settings page placeholder, with the one-time Safari link that the deletion builder keeps in Wave 2.
export const SettingsScreen = (): ReactElement => {
  const [state, setState] = useState<TransferState>({ kind: "idle" });
  const makeLink = async (): Promise<void> => {
    setState({ kind: "sending" });
    try {
      const reply: TransferResponse = await apiFetch(routes.people.transfer);
      setState({ kind: "created", url: reply.url });
    } catch (thrown: unknown) {
      setState({ kind: "failed", error: asApiError(thrown) });
    }
  };
  return (
    <ScreenFrame title="Settings" hideSettingsLink>
      <p>This part arrives in the next build wave.</p>
      <section className="panel" aria-labelledby="transfer-title">
        <h2 id="transfer-title">Open this profile in Safari</h2>
        <p>Opened inside another app? Make a one-time link, then open it in Safari.</p>
        <button type="button" disabled={state.kind === "sending"} onClick={() => void makeLink()}>
          Make a Safari link
        </button>
        {state.kind === "created" ? (
          <>
            <label>
              One-time link
              <input type="text" readOnly value={state.url} />
            </label>
            <CopyButton text={state.url} label="Copy link" />
            <p className="muted">The link works once, for 10 minutes.</p>
          </>
        ) : null}
        {state.kind === "failed" ? <ErrorNotice error={state.error} /> : null}
      </section>
    </ScreenFrame>
  );
};
