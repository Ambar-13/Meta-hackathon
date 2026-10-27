import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ROUTE_PATTERNS, APP_PATHS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS } from "../../testing/fixtures.js";
import { CONSENT_COPY } from "./upload-state.js";
import { UploadScreen } from "./screen.js";

afterEach(() => {
  cleanup();
});

// The ready result the fake prepareUpload returns, with a body that Node's fetch can send.
async function readyResult(): Promise<Record<string, unknown>> {
  const body = await new Response('{"kind":"paste"}\n{"turnIndex":0}').blob();
  return {
    ok: true,
    header: { kind: "paste", parserVersion: "1", scrubVersion: "1", personaSignal: 0.6, attested: true, turnCount: 8 },
    foundTurns: 9,
    keptTurns: 8,
    previewRedactionCount: 1,
    personaSignal: 0.6,
    isLowSignal: false,
    body,
    contentEncoding: "gzip",
  };
}

// Types one paste and checks it with the fake prepareUpload, which the test has set up.
function checkPaste(): void {
  fireEvent.change(screen.getByLabelText("Paste notes about yourself"), { target: { value: "I work best before nine." } });
  fireEvent.click(screen.getByRole("button", { name: "Check what will be sent" }));
}

describe("upload screen, using a fake prepareUpload (needs ingest on main, stage 6.2)", () => {
  it("A3-T1: the consent copy is shown verbatim with the preview count before the upload button, using a fake prepareUpload", async () => {
    const prepare = vi.fn<(...calls: unknown[]) => Promise<Record<string, unknown>>>(() => readyResult());
    renderScreen(<UploadScreen prepare={prepare as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    checkPaste();
    expect(await screen.findByText(CONSENT_COPY)).toBeTruthy();
    expect(screen.getByText("1 private detail will be hidden before upload.")).toBeTruthy();
    expect(screen.getByText("We found 9 of your messages and kept 8.")).toBeTruthy();
    expect(prepare.mock.calls[0]?.[0]).toEqual({ kind: "paste", text: "I work best before nine." });
    expect(requestsTo(routes.sources.createSource)).toHaveLength(0);
  });

  it("R2.7-T1: the upload button stays disabled until the attestation box is ticked, then posts once, using a fake prepareUpload", async () => {
    stubRoute(routes.sources.createSource, { status: 201, body: { sourceId: IDS.source, turnCount: 8, redactionCount: 1, duplicate: false } });
    const prepare = vi.fn<(...calls: unknown[]) => Promise<Record<string, unknown>>>(() => readyResult());
    renderScreen(<UploadScreen prepare={prepare as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    checkPaste();
    const upload = await screen.findByRole("button", { name: "Upload these excerpts" });
    expect(upload.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "These are my own chats." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload these excerpts" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload these excerpts" }));
    expect((await screen.findByTestId("location")).textContent).toBe(`/sources/${IDS.source}/names`);
    expect(requestsTo(routes.sources.createSource)).toHaveLength(1);
  });

  it("D4-T2: the posted body is the prepared body unchanged, using a fake prepareUpload", async () => {
    stubRoute(routes.sources.createSource, { status: 201, body: { sourceId: IDS.source, turnCount: 8, redactionCount: 1, duplicate: false } });
    const prepare = vi.fn<(...calls: unknown[]) => Promise<Record<string, unknown>>>(() => readyResult());
    renderScreen(<UploadScreen prepare={prepare as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    checkPaste();
    fireEvent.click(await screen.findByRole("checkbox", { name: "These are my own chats." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload these excerpts" }));
    await screen.findByTestId("location");
    expect(requestsTo(routes.sources.createSource)[0]?.body).toBe('{"kind":"paste"}\n{"turnIndex":0}');
  });

  it("R1.3-T1: under 640 px the paste tab is first and selected; at 1024 px the file tab is first", () => {
    renderScreen(<UploadScreen prepare={vi.fn() as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    const narrow = screen.getAllByRole("tab");
    expect(narrow.map((tab) => tab.textContent)).toEqual(["Paste notes", "Pick a file"]);
    expect(narrow[0]?.getAttribute("aria-selected")).toBe("true");
    cleanup();
    renderScreen(<UploadScreen prepare={vi.fn() as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload, width: 1024 });
    const wide = screen.getAllByRole("tab");
    expect(wide.map((tab) => tab.textContent)).toEqual(["Pick a file", "Paste notes"]);
    expect(wide[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("R1.3-T2: the file picker offers .zip, .json, .jsonl, .txt and .md", () => {
    renderScreen(<UploadScreen prepare={vi.fn() as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    fireEvent.click(screen.getByRole("tab", { name: "Pick a file" }));
    const input = screen.getByLabelText("Pick your export file (.zip, .json, .jsonl, .txt or .md)");
    expect(input.getAttribute("type")).toBe("file");
    expect(input.getAttribute("accept")).toBe(".zip,.json,.jsonl,.txt,.md");
  });

  it("R3.8-T1: a low persona signal shows the note and the paste offer, using a fake prepareUpload", async () => {
    const prepare = vi.fn(async () => ({ ...(await readyResult()), isLowSignal: true, personaSignal: 0.1 }));
    renderScreen(<UploadScreen prepare={prepare as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    checkPaste();
    expect(await screen.findByText("Most of these messages look like tasks or code, not about you, so the card may come out thin. Pasting a few notes about yourself works better.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paste notes instead" }));
    expect(screen.getByRole("tab", { name: "Paste notes" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Paste notes about yourself")).toBeTruthy();
  });

  it("D9-T1: a refusal is shown exactly as ingest wrote it and nothing is posted, using a fake prepareUpload", async () => {
    const message = "No messages written by you were found in this file. Pick the export file itself (conversations.json inside the zip), or paste some notes instead.";
    const prepare = vi.fn<(...calls: unknown[]) => Promise<Record<string, unknown>>>(() => Promise.resolve({ ok: false, code: "source_no_own_turns", message }));
    renderScreen(<UploadScreen prepare={prepare as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    checkPaste();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(message);
    expect(requestsTo(routes.sources.createSource)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Start again" })).toBeTruthy();
  });

  it("A3-T2: every control on the upload page has an accessible name at 375 px, using a fake prepareUpload", async () => {
    const prepare = vi.fn<(...calls: unknown[]) => Promise<Record<string, unknown>>>(() => readyResult());
    renderScreen(<UploadScreen prepare={prepare as never} />, { pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload });
    expect(unlabelledControls(document.body)).toEqual([]);
    checkPaste();
    await screen.findByText(CONSENT_COPY);
    expect(unlabelledControls(document.body)).toEqual([]);
  });
});
