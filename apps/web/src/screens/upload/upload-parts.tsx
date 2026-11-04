import { useState, type ReactElement } from "react";
import type { UploadProgress, UploadReady } from "../../extract/index.js";
import { LoadingLine, Sticker } from "../../look/index.js";
import { CONSENT_COPY, STAGE_WORDS } from "./upload-state.js";

// The words for a low persona signal (drafted copy).
const LOW_SIGNAL_NOTE =
  "These are mostly tasks or code, so your card may come out thin. A few notes about yourself help.";
// The worker's stages in the order it reports them, for the step list under the progress line.
const STAGE_ORDER: readonly UploadProgress["stage"][] = [
  "reading",
  "parsing",
  "scrubbing",
  "compressing",
];

// The two tabs; under 640 px paste is first, otherwise the file tab is first.
export const UploadTabs = (props: {
  isNarrow: boolean;
  selected: "paste" | "file";
  onSelect: (tab: "paste" | "file") => void;
}): ReactElement => {
  const paste = (
    <button
      key="paste"
      type="button"
      role="tab"
      id="tab-paste"
      aria-controls="panel-paste"
      aria-selected={props.selected === "paste"}
      onClick={() => {
        props.onSelect("paste");
      }}
    >
      Paste notes
    </button>
  );
  const file = (
    <button
      key="file"
      type="button"
      role="tab"
      id="tab-file"
      aria-controls="panel-file"
      aria-selected={props.selected === "file"}
      onClick={() => {
        props.onSelect("file");
      }}
    >
      Pick a file
    </button>
  );
  return (
    <div className="tabs up-tabs" role="tablist" aria-label="How to add your notes">
      {props.isNarrow ? [paste, file] : [file, paste]}
    </div>
  );
};

// The paste box and its check button; the button stays shut while the box is empty.
export const PasteTab = (props: {
  isBusy: boolean;
  onSubmit: (text: string) => void;
}): ReactElement => {
  const [text, setText] = useState("");
  const isEmpty = text.trim() === "";
  return (
    <div role="tabpanel" id="panel-paste" aria-labelledby="tab-paste" className="up-pane">
      <label className="up-paste-label">
        Paste notes about yourself
        <textarea
          rows={10}
          value={text}
          aria-describedby="paste-hint"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <p className="hint" id="paste-hint">
        {isEmpty
          ? "The box is empty. Paste a few lines about how you work and what you care about."
          : "Nothing leaves this device until you see what will be sent."}
      </p>
      <div className="actions">
        <button
          type="button"
          className="big"
          disabled={isEmpty || props.isBusy}
          onClick={() => {
            props.onSubmit(text);
          }}
        >
          Check what will be sent
        </button>
      </div>
    </div>
  );
};

// The file picker, which offers the five export types, .jsonl being a Codex session log; the
// picker's own button is the main action.
export const FileTab = (props: { isBusy: boolean; onPick: (file: File) => void }): ReactElement => {
  return (
    <div role="tabpanel" id="panel-file" aria-labelledby="tab-file" className="up-pane">
      <div className="up-drop">
        <Sticker name="laptop" className="up-drop-stk" />
        <label className="up-file-label">
          Pick your export file (.zip, .json, .jsonl, .txt or .md)
          <input
            type="file"
            accept=".zip,.json,.jsonl,.txt,.md"
            disabled={props.isBusy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) props.onPick(file);
            }}
          />
        </label>
      </div>
    </div>
  );
};

// Where one stage stands against the stage the worker is on now.
function stageState(
  stage: UploadProgress["stage"],
  progress: UploadProgress | null,
): "done" | "now" | "next" {
  if (progress === null) return "next";
  const now = STAGE_ORDER.indexOf(progress.stage);
  const index = STAGE_ORDER.indexOf(stage);
  if (index < now) return "done";
  return index === now ? "now" : "next";
}

// The worker's progress line, the four steps it goes through, and the stop button.
export const PreparingLine = (props: {
  progress: UploadProgress | null;
  onCancel: () => void;
}): ReactElement => {
  const words =
    props.progress === null
      ? "Getting ready."
      : `${STAGE_WORDS[props.progress.stage]}. ${String(props.progress.keptTurns)} messages kept so far.`;
  return (
    <section className="up-working">
      <LoadingLine text={words} />
      <ol className="up-steps" aria-label="Steps">
        {STAGE_ORDER.map((stage) => (
          <li key={stage} className={`up-step ${stageState(stage, props.progress)}`}>
            <span className="up-step-dot" aria-hidden="true" />
            {STAGE_WORDS[stage]}
          </li>
        ))}
      </ol>
      <div className="actions">
        <button type="button" className="quiet" onClick={props.onCancel}>
          Stop
        </button>
      </div>
    </section>
  );
};

// The count line for the preview, with the right word for one private detail.
function redactionLine(count: number): string {
  if (count === 1) return "1 private detail will be hidden before upload.";
  return `${String(count)} private details will be hidden before upload.`;
}

// What will be sent: the counts, the consent copy, the low-signal note, the attestation box and the
// upload button.
export const PreviewPanel = (props: {
  ready: UploadReady;
  isAttested: boolean;
  isUploading: boolean;
  onAttest: (isAttested: boolean) => void;
  onUpload: () => void;
  onPasteInstead: () => void;
}): ReactElement => {
  const { ready } = props;
  return (
    <section className="up-preview" aria-labelledby="preview-title">
      <div className="up-counts">
        <Sticker name="check" className="up-counts-stk" />
        <h2 id="preview-title">What will be sent</h2>
        <p>{`We found ${String(ready.foundTurns)} of your messages and kept ${String(ready.keptTurns)}.`}</p>
        <p>{redactionLine(ready.previewRedactionCount)}</p>
      </div>
      <p className="up-consent">{CONSENT_COPY}</p>
      {ready.isLowSignal ? (
        <div className="up-low">
          <p>{LOW_SIGNAL_NOTE}</p>
          <button type="button" className="quiet" onClick={props.onPasteInstead}>
            Paste notes instead
          </button>
        </div>
      ) : null}
      <label className="inline up-attest">
        <input
          type="checkbox"
          checked={props.isAttested}
          onChange={(event) => {
            props.onAttest(event.target.checked);
          }}
        />
        These are my own chats.
      </label>
      <div className="actions">
        <button
          type="button"
          className="big"
          disabled={!props.isAttested || props.isUploading}
          onClick={props.onUpload}
        >
          Upload these messages
        </button>
      </div>
      {props.isUploading ? <LoadingLine text="Uploading your excerpts." /> : null}
    </section>
  );
};
