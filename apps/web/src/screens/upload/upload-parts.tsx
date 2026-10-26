import { useState, type ReactElement } from "react";
import type { UploadProgress, UploadReady } from "../../extract/index.js";
import { CONSENT_COPY, STAGE_WORDS } from "./upload-state.js";

// The words for a low persona signal [confirm] (drafted copy, no input gives it).
const LOW_SIGNAL_NOTE = "Most of these messages look like tasks or code, not about you, so the card may come out thin. Pasting a few notes about yourself works better.";

// The two tabs; under 640 px paste is first, otherwise the file tab is first (R1.3).
export const UploadTabs = (props: { isNarrow: boolean; selected: "paste" | "file"; onSelect: (tab: "paste" | "file") => void }): ReactElement => {
  const paste = (
    <button key="paste" type="button" role="tab" id="tab-paste" aria-controls="panel-paste" aria-selected={props.selected === "paste"} onClick={() => { props.onSelect("paste"); }}>
      Paste notes
    </button>
  );
  const file = (
    <button key="file" type="button" role="tab" id="tab-file" aria-controls="panel-file" aria-selected={props.selected === "file"} onClick={() => { props.onSelect("file"); }}>
      Pick a file
    </button>
  );
  return (
    <div className="tabs" role="tablist" aria-label="How to add your notes">
      {props.isNarrow ? [paste, file] : [file, paste]}
    </div>
  );
};

// The paste box and its check button.
export const PasteTab = (props: { isBusy: boolean; onSubmit: (text: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  return (
    <div role="tabpanel" id="panel-paste" aria-labelledby="tab-paste">
      <label>
        Paste notes about yourself
        <textarea rows={10} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="button" disabled={text.trim() === "" || props.isBusy} onClick={() => { props.onSubmit(text); }}>
        Check what will be sent
      </button>
    </div>
  );
};

// The file picker, which offers the four export types (R1.3).
export const FileTab = (props: { isBusy: boolean; onPick: (file: File) => void }): ReactElement => {
  return (
    <div role="tabpanel" id="panel-file" aria-labelledby="tab-file">
      <label>
        Pick your export file (.zip, .json, .txt or .md)
        <input
          type="file"
          accept=".zip,.json,.txt,.md"
          disabled={props.isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) props.onPick(file);
          }}
        />
      </label>
    </div>
  );
};

// The worker's progress line and the stop button.
export const PreparingLine = (props: { progress: UploadProgress | null; onCancel: () => void }): ReactElement => {
  const words = props.progress === null ? "Getting ready." : `${STAGE_WORDS[props.progress.stage]}. ${String(props.progress.keptTurns)} messages kept so far.`;
  return (
    <div>
      <p role="status">{words}</p>
      <button type="button" className="quiet" onClick={props.onCancel}>
        Stop
      </button>
    </div>
  );
};

// The count line for the preview, with the right word for one private detail.
function redactionLine(count: number): string {
  if (count === 1) return "1 private detail will be hidden before upload.";
  return `${String(count)} private details will be hidden before upload.`;
}

// What will be sent: the counts, the consent copy, the low-signal note, the attestation box and the upload button (A3, R2.7, R3.8).
export const PreviewPanel = (props: { ready: UploadReady; isAttested: boolean; isUploading: boolean; onAttest: (isAttested: boolean) => void; onUpload: () => void; onPasteInstead: () => void }): ReactElement => {
  const { ready } = props;
  return (
    <section className="panel">
      <p>{`We found ${String(ready.foundTurns)} of your messages and kept ${String(ready.keptTurns)}.`}</p>
      <p>{redactionLine(ready.previewRedactionCount)}</p>
      <p>{CONSENT_COPY}</p>
      {ready.isLowSignal ? (
        <>
          <p>{LOW_SIGNAL_NOTE}</p>
          <button type="button" className="quiet" onClick={props.onPasteInstead}>
            Paste notes instead
          </button>
        </>
      ) : null}
      <label className="inline">
        <input type="checkbox" checked={props.isAttested} onChange={(event) => { props.onAttest(event.target.checked); }} />
        These are my own chats.
      </label>
      <button type="button" disabled={!props.isAttested || props.isUploading} onClick={props.onUpload}>
        Upload these excerpts
      </button>
      {props.isUploading ? <p role="status">Uploading.</p> : null}
    </section>
  );
};
