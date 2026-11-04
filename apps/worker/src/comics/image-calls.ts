import { PANEL_MAX_BYTES } from "@meet-first/contracts";
import { LimiterBusy, type LlmClient } from "@meet-first/llm";
import sharp from "sharp";

// One panel that was encoded and fits under the size cap.
export type PanelRender = { position: number; bytes: Uint8Array; sizeBytes: number };
// How the six image calls ended: all six panels, a reason they cannot be stored, the deadline, or a full token window.
export type RenderOutcome =
  | { kind: "ready"; panels: PanelRender[] }
  | { kind: "failed"; reason: "render_failed" }
  | { kind: "deadline" }
  | { kind: "limiter_busy" };
// The result of encoding one image: its webp bytes, or the reason it is too large.
export type EncodeResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: "over_size_cap" };
// What the renderer needs from the model client: the image call only, so a test can pass a fake.
type ImageClient = Pick<LlmClient, "image">;
// The result of a promise that either finished or lost a race to the deadline.
export type Raced<T> = { kind: "done"; value: T } | { kind: "deadline" };

// The side of a panel image in pixels, 1024 by 1024.
const PANEL_EDGE_PX = 1024;
// The webp quality of the first encode of a panel.
const FIRST_QUALITY = 80;
// The webp quality of the second encode, used only when the first is over the cap.
const SECOND_QUALITY = 60;

// Resolves with the promise's value, or with deadline when the signal fires first. A late result is dropped, never returned.
export function raceWithDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<Raced<T>> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.resolve({ kind: "deadline" });
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      resolve({ kind: "deadline" });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve({ kind: "done", value });
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// The one part of a sharp pipeline this file reads: its encoded bytes. sharp's typings name a Buffer type the workspace's @types/node does not declare, so the output is read through this shape.
export type EncodedPipeline = { toBuffer: () => Promise<Uint8Array> };

// Encodes one webp at the given quality, 1024 by 1024, cover fit.
async function webpAt(bytes: Uint8Array, quality: number): Promise<Uint8Array> {
  const pipeline = sharp(bytes)
    .resize(PANEL_EDGE_PX, PANEL_EDGE_PX, { fit: "cover" })
    .webp({ quality }) as unknown as EncodedPipeline;
  return pipeline.toBuffer();
}

// Encodes image bytes as webp at quality 80; if that is over the cap, once more at quality 60; still over is refused.
export async function encodePanelWebp(bytes: Uint8Array): Promise<EncodeResult> {
  const first = await webpAt(bytes, FIRST_QUALITY);
  if (first.length <= PANEL_MAX_BYTES) return { ok: true, bytes: first };
  const second = await webpAt(bytes, SECOND_QUALITY);
  if (second.length <= PANEL_MAX_BYTES) return { ok: true, bytes: second };
  return { ok: false, reason: "over_size_cap" };
}

// Runs one image call per prompt in parallel, with no retry, and encodes every result. Resolves as failed for any rejected call or any image that cannot be stored.
export async function renderPanels(
  llm: ImageClient,
  prompts: string[],
  options: { signal: AbortSignal; meetingId: string },
): Promise<RenderOutcome> {
  const calls = prompts.map((prompt) =>
    llm.image({
      callSite: "comic_image",
      prompt,
      ledger: { personId: null, meetingId: options.meetingId },
    }),
  );
  const settled = await raceWithDeadline(Promise.allSettled(calls), options.signal);
  if (settled.kind === "deadline" || options.signal.aborted) return { kind: "deadline" };
  const results = settled.value;
  if (results.every(isRefusedByLimiter)) return { kind: "limiter_busy" };
  const panels: PanelRender[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") return { kind: "failed", reason: "render_failed" };
    const encoded = await encodeOrNull(result.value.webp);
    if (encoded === undefined || !encoded.ok) return { kind: "failed", reason: "render_failed" };
    panels.push({ position: index + 1, bytes: encoded.bytes, sizeBytes: encoded.bytes.length });
  }
  return { kind: "ready", panels };
}

// True when one settled call was refused by the full token window, so no bytes came back from it.
function isRefusedByLimiter(
  result: PromiseSettledResult<{ webp: Uint8Array; ledgerId: string }>,
): boolean {
  return result.status === "rejected" && isLimiterBusy(result.reason);
}

// True when a reason is the limiter's refusal.
function isLimiterBusy(reason: unknown): boolean {
  return reason instanceof LimiterBusy;
}

// Encodes one image, or undefined when the bytes are not an image sharp can read.
async function encodeOrNull(bytes: Uint8Array): Promise<EncodeResult | undefined> {
  try {
    return await encodePanelWebp(bytes);
  } catch {
    return undefined;
  }
}
