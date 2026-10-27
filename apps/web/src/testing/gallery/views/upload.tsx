import type { ReactElement } from "react";
import { ApiError, APP_PATHS, ROUTE_PATTERNS } from "../../../app-shell/index.js";
import type { UploadReady } from "../../../extract/index.js";
import { UploadView, type UploadActions } from "../../../screens/upload/screen.js";
import { useIsNarrowScreen, type UploadFlow } from "../../../screens/upload/upload-state.js";
import type { GalleryView } from "../gallery-views.js";

// Actions that do nothing: the gallery shows one state and stays there.
const NO_ACTIONS: UploadActions = {
  onTab: () => undefined,
  onStart: () => undefined,
  onCancel: () => undefined,
  onReset: () => undefined,
  onPasteInstead: () => undefined,
  onAttest: () => undefined,
  onUpload: () => undefined,
};

// A prepared upload as the extraction worker would hand it back: 42 messages found, 38 kept, 3 details hidden.
function ready(isLowSignal: boolean): UploadReady {
  return {
    ok: true,
    header: { kind: "chatgpt", parserVersion: "1", scrubVersion: "1", personaSignal: isLowSignal ? 0.1 : 0.6, attested: true, turnCount: 38 },
    foundTurns: 42,
    keptTurns: 38,
    previewRedactionCount: 3,
    personaSignal: isLowSignal ? 0.1 : 0.6,
    isLowSignal,
    body: new Blob(["{}"]),
    contentEncoding: "gzip",
  };
}

// The sentences the worker sends back for each refusal shown here, word for word from the extraction code.
const TOO_BIG = "This file is over 150 MB, more than a phone browser can read. Export a shorter date range, or paste your notes instead.";
const NOT_AN_EXPORT = "This file is not a JSON export. Pick conversations.json from the zip, or paste text.";
const NONE_OF_YOURS = "No messages written by you were found in this file. Pick the export file itself (conversations.json inside the zip), or paste some notes instead.";

// The upload page in one fixed flow state, with the tab order the real page picks for the width.
const UploadAt = (props: { flow: UploadFlow; tab?: "paste" | "file" }): ReactElement => {
  const isNarrow = useIsNarrowScreen();
  const tab = props.tab ?? (isNarrow ? "paste" : "file");
  return <UploadView flow={props.flow} tab={tab} isNarrow={isNarrow} actions={NO_ACTIONS} />;
};

// One upload view on the upload route.
function uploadView(name: string, title: string, element: ReactElement): GalleryView {
  return { name, title, pattern: ROUTE_PATTERNS.upload, url: APP_PATHS.upload, element };
}

// Every state of the upload page, for the file tab and the paste tab.
export const views: readonly GalleryView[] = [
  uploadView("upload-file-choosing", "Upload, the file tab before a file is picked", <UploadAt flow={{ kind: "idle" }} tab="file" />),
  uploadView("upload-paste-empty", "Upload, the paste tab with an empty box (the check button stays shut)", <UploadAt flow={{ kind: "idle" }} tab="paste" />),
  uploadView("upload-reading", "Upload, getting ready to read", <UploadAt flow={{ kind: "preparing", progress: null }} />),
  uploadView("upload-extracting", "Upload, reading and hiding private details", <UploadAt flow={{ kind: "preparing", progress: { stage: "scrubbing", inflatedBytes: 1_200_000, keptTurns: 31 } }} />),
  uploadView("upload-preview", "Upload, the scrub preview before the box is ticked", <UploadAt flow={{ kind: "ready", ready: ready(false), isAttested: false }} />),
  uploadView("upload-preview-ticked", "Upload, the scrub preview with the box ticked", <UploadAt flow={{ kind: "ready", ready: ready(false), isAttested: true }} />),
  uploadView("upload-preview-thin", "Upload, the scrub preview of a file that is mostly tasks or code", <UploadAt flow={{ kind: "ready", ready: ready(true), isAttested: false }} />),
  uploadView("upload-sending", "Upload, sending the excerpts", <UploadAt flow={{ kind: "uploading", ready: ready(false) }} />),
  uploadView(
    "upload-send-failed",
    "Upload, the send failed",
    <UploadAt flow={{ kind: "failed", ready: ready(false), error: new ApiError({ status: 0, code: "network_failed", message: "The server could not be reached. Check your connection and try again." }) }} />,
  ),
  uploadView("upload-too-big", "Upload, a file that is too big", <UploadAt flow={{ kind: "refused", refusal: { ok: false, code: "zip_too_large", message: TOO_BIG } }} />),
  uploadView("upload-not-export", "Upload, a file that is not a supported export", <UploadAt flow={{ kind: "refused", refusal: { ok: false, code: "source_file_not_json", message: NOT_AN_EXPORT } }} />),
  uploadView("upload-paste-none-mine", "Upload, a paste with none of your own messages", <UploadAt flow={{ kind: "refused", refusal: { ok: false, code: "source_no_own_turns", message: NONE_OF_YOURS } }} />),
  uploadView("upload-crashed", "Upload, the file check stopped", <UploadAt flow={{ kind: "crashed" }} />),
];
