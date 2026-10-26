import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { prepareUpload } from "../../extract/index.js";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { useIsNarrowScreen, useUploadFlow, type UploadFlow } from "./upload-state.js";
import { FileTab, PasteTab, PreparingLine, PreviewPanel, UploadTabs } from "./upload-parts.js";

// The shown flow states other than idle: the progress line, the refusal, the file check crash, and the preview with its upload.
type SubmittedProps = { flow: UploadFlow; onCancel: () => void; onReset: () => void; onPasteInstead: () => void; onAttest: (isAttested: boolean) => void; onUpload: () => void };

// The screen body for the flow after the person picked or pasted something.
const FlowBody = (props: SubmittedProps): ReactElement | null => {
  const { flow } = props;
  if (flow.kind === "preparing") return <PreparingLine progress={flow.progress} onCancel={props.onCancel} />;
  if (flow.kind === "refused") {
    return (
      <>
        <div className="notice" role="alert">
          <p>{flow.refusal.message}</p>
        </div>
        <button type="button" className="quiet" onClick={props.onReset}>
          Start again
        </button>
      </>
    );
  }
  if (flow.kind === "crashed") {
    return (
      <>
        <p>The file check stopped. Reload the page and try again.</p>
        <button type="button" className="quiet" onClick={props.onReset}>
          Start again
        </button>
      </>
    );
  }
  if (flow.kind === "ready" || flow.kind === "uploading" || flow.kind === "failed") {
    const isAttested = flow.kind === "ready" ? flow.isAttested : true;
    return (
      <>
        <PreviewPanel ready={flow.ready} isAttested={isAttested} isUploading={flow.kind === "uploading"} onAttest={props.onAttest} onUpload={props.onUpload} onPasteInstead={props.onPasteInstead} />
        {flow.kind === "failed" ? <ErrorNotice error={flow.error} /> : null}
      </>
    );
  }
  return null;
};

// The upload page: paste or pick, see what will be sent, attest, upload (seams S4, A3, R1.3, R2.7).
export const UploadScreen = (props: { prepare?: typeof prepareUpload }): ReactElement => {
  const navigate = useNavigate();
  const isNarrow = useIsNarrowScreen();
  const [tab, setTab] = useState<"paste" | "file">(isNarrow ? "paste" : "file");
  const upload = useUploadFlow(props.prepare ?? prepareUpload, (sourceId) => {
    navigate(APP_PATHS.namesReview(sourceId));
  });
  const { flow } = upload;
  const pasteInstead = (): void => {
    upload.reset();
    setTab("paste");
  };
  return (
    <ScreenFrame title="Add what your AI knows about you">
      {flow.kind === "idle" ? (
        <>
          <UploadTabs isNarrow={isNarrow} selected={tab} onSelect={setTab} />
          {tab === "paste" ? <PasteTab isBusy={false} onSubmit={(text) => { upload.start({ kind: "paste", text }); }} /> : <FileTab isBusy={false} onPick={(file) => { upload.start({ kind: "file", file }); }} />}
        </>
      ) : (
        <FlowBody flow={flow} onCancel={upload.cancel} onReset={upload.reset} onPasteInstead={pasteInstead} onAttest={upload.setAttested} onUpload={() => void upload.upload()} />
      )}
    </ScreenFrame>
  );
};
