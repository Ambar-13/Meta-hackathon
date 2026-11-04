import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, NETWORK_FAILED_SENTENCE } from "./api-fetch.js";

// One view kept fresh by polling: the last good value, the last error, whether a request is out, and a reload.
export type PolledView<T> = {
  value: T | null;
  error: ApiError | null;
  isLoading: boolean;
  reload: () => void;
};

// The statuses that stop a poll: the session or the page is gone for good.
const STOP_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

// The state the hook keeps between renders.
type PollState<T> = { value: T | null; error: ApiError | null; isLoading: boolean };

// Turns whatever a failed load threw into an ApiError (4.2.5 step 3).
function toApiError(thrown: unknown): ApiError {
  if (thrown instanceof ApiError) return thrown;
  return new ApiError({ status: 0, code: "network_failed", message: NETWORK_FAILED_SENTENCE });
}

// Loads at once, then again intervalMs after each settled request while keepPolling(value) is true; key restarts it.
export function usePolledView<T>(
  load: () => Promise<T>,
  options: { key: string; intervalMs: number; keepPolling: (value: T) => boolean },
): PolledView<T> {
  const [view, setView] = useState<PollState<T>>({ value: null, error: null, isLoading: true });
  const latest = useRef({ load, options });
  latest.current = { load, options };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runNow = useRef<() => void>(() => undefined);
  const key = options.key;

  useEffect(() => {
    let isMounted = true;
    const clearTimer = (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const schedule = (): void => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        run();
      }, latest.current.options.intervalMs);
    };
    const run = (): void => {
      clearTimer();
      setView((previous) => ({ ...previous, isLoading: true }));
      latest.current.load().then(
        (value) => {
          if (!isMounted) return;
          setView({ value, error: null, isLoading: false });
          if (latest.current.options.keepPolling(value)) schedule();
        },
        (thrown: unknown) => {
          if (!isMounted) return;
          const error = toApiError(thrown);
          setView((previous) => ({ value: previous.value, error, isLoading: false }));
          if (!STOP_STATUSES.has(error.status)) schedule();
        },
      );
    };
    runNow.current = run;
    run();
    return () => {
      isMounted = false;
      clearTimer();
    };
  }, [key]);

  const reload = useCallback(() => {
    runNow.current();
  }, []);

  return { value: view.value, error: view.error, isLoading: view.isLoading, reload };
}
