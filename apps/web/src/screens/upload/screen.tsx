import "./upload.css";
import { useId, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { prepareUpload, type UploadInput } from "../../extract/index.js";
import { APP_PATHS, ApiError, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { SummarySection, useSummary, type SummaryHook } from "../summary/index.js";
import { useIsNarrowScreen, useUploadFlow, type UploadFlow } from "./upload-state.js";
import { FileTab, PasteTab, PreparingLine, PreviewPanel, UploadTabs } from "./upload-parts.js";

// The sentence for a file check that crashed; it has no code of its own, so it is shown as a status 0 error.
const CRASHED_SENTENCE = "The file check stopped. Reload the page and try again.";

// What the page does when the person acts: pick a tab, start, stop, start over, paste instead, attest, upload.
export type UploadActions = {
  onTab: (tab: "paste" | "file") => void;
  onStart: (input: UploadInput) => void;
  onCancel: () => void;
  onReset: () => void;
  onPasteInstead: () => void;
  onAttest: (isAttested: boolean) => void;
  onUpload: () => void;
};

// A stop in the flow: the error, then the one way on, which is to start again.
const StopBody = (props: { error: ApiError; onReset: () => void }): ReactElement => {
  return (
    <section className="up-stop">
      <ErrorNotice error={props.error} />
      <div className="actions">
        <button type="button" onClick={props.onReset}>
          Start again
        </button>
      </div>
    </section>
  );
};

// The screen body for the flow after the person picked or pasted something.
const FlowBody = (props: { flow: UploadFlow; actions: UploadActions }): ReactElement | null => {
  const { flow, actions } = props;
  if (flow.kind === "preparing") return <PreparingLine progress={flow.progress} onCancel={actions.onCancel} />;
  if (flow.kind === "refused") {
    return <StopBody error={new ApiError({ status: 0, code: flow.refusal.code, message: flow.refusal.message })} onReset={actions.onReset} />;
  }
  if (flow.kind === "crashed") {
    return <StopBody error={new ApiError({ status: 0, code: "file_check_crashed", message: CRASHED_SENTENCE })} onReset={actions.onReset} />;
  }
  if (flow.kind === "ready" || flow.kind === "uploading" || flow.kind === "failed") {
    const isAttested = flow.kind === "ready" ? flow.isAttested : true;
    return (
      <>
        <PreviewPanel ready={flow.ready} isAttested={isAttested} isUploading={flow.kind === "uploading"} onAttest={actions.onAttest} onUpload={actions.onUpload} onPasteInstead={actions.onPasteInstead} />
        {flow.kind === "failed" ? <ErrorNotice error={flow.error} /> : null}
      </>
    );
  }
  return null;
};

// The page for one flow state: while nothing is picked, your AI's summary first, then your chats with their lede and tabs; after that
// the flow body. The gallery renders it directly.
export const UploadView = (props: { flow: UploadFlow; tab: "paste" | "file"; isNarrow: boolean; actions: UploadActions; summary: SummaryHook }): ReactElement => {
  const { flow, actions } = props;
  const chatsId = useId();
  return (
    <ScreenFrame title="Add what your AI knows about you">
      {flow.kind === "idle" ? (
        <>
          <SummarySection hasChats={null} summary={props.summary} />
          <section className="up-chats" aria-labelledby={chatsId}>
            <h2 id={chatsId}>Your chats</h2>
            <p className="up-lede">Pick a chat export or paste a few notes. You see what will be sent before anything leaves this device.</p>
            <UploadTabs isNarrow={props.isNarrow} selected={props.tab} onSelect={actions.onTab} />
            {props.tab === "paste" ? <PasteTab isBusy={false} onSubmit={(text) => { actions.onStart({ kind: "paste", text }); }} /> : <FileTab isBusy={false} onPick={(file) => { actions.onStart({ kind: "file", file }); }} />}
          </section>
        </>
      ) : (
        <FlowBody flow={flow} actions={actions} />
      )}
    </ScreenFrame>
  );
};

// The upload page: your AI's summary, then paste or pick, see what will be sent, attest, upload. The summary's quotes and topics go to
// the file check, so what you said first is kept first.
export const UploadScreen = (props: { prepare?: typeof prepareUpload }): ReactElement => {
  const navigate = useNavigate();
  const isNarrow = useIsNarrowScreen();
  const summary = useSummary();
  const [tab, setTab] = useState<"paste" | "file">(isNarrow ? "paste" : "file");
  const upload = useUploadFlow(props.prepare ?? prepareUpload, (sourceId) => {
    navigate(APP_PATHS.namesReview(sourceId));
  });
  const actions: UploadActions = {
    onTab: setTab,
    onStart: (input) => {
      upload.start(input, summary.priority);
    },
    onCancel: upload.cancel,
    onReset: upload.reset,
    onPasteInstead: () => {
      upload.reset();
      setTab("paste");
    },
    onAttest: upload.setAttested,
    onUpload: () => void upload.upload(),
  };
  return <UploadView flow={upload.flow} tab={tab} isNarrow={isNarrow} actions={actions} summary={summary} />;
};
