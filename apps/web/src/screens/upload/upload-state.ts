import { useEffect, useRef, useState } from "react";
import {
  prepareUpload,
  type UploadInput,
  type UploadProgress,
  type UploadReady,
  type UploadRefused,
} from "../../extract/index.js";
import type { SummaryPriority } from "@meet-first/parsers";
import { apiUpload, asApiError, ApiError, readAllowlist } from "../../app-shell/index.js";

// The consent copy, shown unchanged with the preview count before the upload button.
export const CONSENT_COPY =
  "Your original archive stays on your device. After you review redactions, we upload and store only the selected excerpts shown here. You can delete them at any time.";
// Under 640 px the paste tab comes first.
export const NARROW_SCREEN_QUERY = "(max-width: 639px)";
// The words shown for each stage the extraction worker reports (drafted copy).
export const STAGE_WORDS: Record<UploadProgress["stage"], string> = {
  reading: "Reading the file",
  parsing: "Finding your own messages",
  scrubbing: "Hiding private details",
  compressing: "Packing the upload",
};

// The upload flow, from picking to the names screen.
export type UploadFlow =
  | { kind: "idle" }
  | { kind: "preparing"; progress: UploadProgress | null }
  | { kind: "refused"; refusal: UploadRefused }
  | { kind: "crashed" }
  | { kind: "ready"; ready: UploadReady; isAttested: boolean }
  | { kind: "uploading"; ready: UploadReady }
  | { kind: "failed"; ready: UploadReady; error: ApiError };

// True when the screen is under 640 px wide: matchMedia now and on every change.
export function useIsNarrowScreen(): boolean {
  const [query] = useState(() => window.matchMedia(NARROW_SCREEN_QUERY));
  const [isNarrowNow, setIsNarrowNow] = useState(query.matches);
  useEffect(() => {
    const listener = (event: MediaQueryListEvent): void => {
      setIsNarrowNow(event.matches);
    };
    query.addEventListener("change", listener);
    return () => {
      query.removeEventListener("change", listener);
    };
  }, [query]);
  return isNarrowNow;
}

// Drives the flow: prepareUpload with the summary's quotes and topics to keep first when there is a summary, the attestation, the
// upload, then onUploaded with the new source id.
export function useUploadFlow(
  prepare: typeof prepareUpload,
  onUploaded: (sourceId: string) => void,
): {
  flow: UploadFlow;
  start: (input: UploadInput, priority?: SummaryPriority) => void;
  cancel: () => void;
  setAttested: (isAttested: boolean) => void;
  upload: () => Promise<void>;
  reset: () => void;
} {
  const [flow, setFlow] = useState<UploadFlow>({ kind: "idle" });
  const flowRef = useRef<UploadFlow>(flow);
  flowRef.current = flow;
  const controller = useRef<AbortController | null>(null);

  const start = (input: UploadInput, priority?: SummaryPriority): void => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setFlow({ kind: "preparing", progress: null });
    const onProgress = (progress: UploadProgress): void => {
      setFlow((current) =>
        current.kind === "preparing" ? { kind: "preparing", progress } : current,
      );
    };
    const first = priority === undefined ? {} : { priority };
    prepare(input, { allowlist: readAllowlist(), onProgress, signal: next.signal, ...first }).then(
      (result) => {
        if (controller.current !== next) return;
        setFlow(
          result.ok
            ? { kind: "ready", ready: result, isAttested: false }
            : { kind: "refused", refusal: result },
        );
      },
      () => {
        if (controller.current === next) setFlow({ kind: "crashed" });
      },
    );
  };

  const cancel = (): void => {
    controller.current?.abort();
  };

  const setAttested = (isAttested: boolean): void => {
    setFlow((current) => (current.kind === "ready" ? { ...current, isAttested } : current));
  };

  const upload = async (): Promise<void> => {
    const current = flowRef.current;
    if (current.kind !== "ready" || !current.isAttested) return;
    setFlow({ kind: "uploading", ready: current.ready });
    try {
      const reply = await apiUpload({
        body: current.ready.body,
        contentEncoding: current.ready.contentEncoding,
      });
      onUploaded(reply.sourceId);
    } catch (thrown: unknown) {
      setFlow({ kind: "failed", ready: current.ready, error: asApiError(thrown) });
    }
  };

  const reset = (): void => {
    controller.current?.abort();
    controller.current = null;
    setFlow({ kind: "idle" });
  };

  return { flow, start, cancel, setAttested, upload, reset };
}
