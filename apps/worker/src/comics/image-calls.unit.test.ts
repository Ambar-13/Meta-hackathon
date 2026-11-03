import { LimiterBusy } from "@meet-first/llm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { encodePanelWebp, renderPanels, type EncodedPipeline } from "./image-calls.js";

// The largest stored panel in bytes.
const CAP_BYTES = 153_600;
// The meeting id the fake calls name in their ledger.
const MEETING_ID = "00000000-0000-4000-8000-000000000501";

// A flat colour square as a PNG, the kind of image the model returns.
async function flatPng(): Promise<Uint8Array> {
  const pipeline = sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#e8c547" } }).png() as unknown as EncodedPipeline;
  return pipeline.toBuffer();
}

// A 1024 by 1024 PNG of random pixels, which stays over the cap after two webp encodes.
async function noisePng(): Promise<Uint8Array> {
  const raw = new Uint8Array(1024 * 1024 * 3);
  let seed = 20261026;
  for (let index = 0; index < raw.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[index] = seed & 0xff;
  }
  const pipeline = sharp(raw, { raw: { width: 1024, height: 1024, channels: 3 } }).png() as unknown as EncodedPipeline;
  return pipeline.toBuffer();
}

// The prompts the fake calls receive: six, one per panel.
const PROMPTS = ["one", "two", "three", "four", "five", "six"];

describe("comic image calls", () => {
  let flat: Uint8Array;
  let noise: Uint8Array;
  beforeAll(async () => {
    flat = await flatPng();
    noise = await noisePng();
  });

  it("W2-COMIC-T4 (D64, R11.5): a panel over 150 KB after two encodes is refused", async () => {
    const refused = await encodePanelWebp(noise);
    expect(refused).toEqual({ ok: false, reason: "over_size_cap" });
    const accepted = await encodePanelWebp(flat);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.bytes.length).toBeLessThanOrEqual(CAP_BYTES);
  });

  it("W2-COMIC-T5 (D64): renderPanels runs six calls in parallel and never retries, using a fake llm client and says so", async () => {
    let inFlight = 0;
    let peak = 0;
    let total = 0;
    const slowFake = {
      image: async () => {
        total += 1;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlight -= 1;
        return { webp: flat, ledgerId: "fake-ledger" };
      },
    };
    const ready = await renderPanels(slowFake, PROMPTS, { signal: new AbortController().signal, meetingId: MEETING_ID });
    expect(ready.kind).toBe("ready");
    if (ready.kind === "ready") expect(ready.panels.map((panel) => panel.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(6);
    expect(total).toBe(6);

    let failTotal = 0;
    const oneFails = {
      image: () => {
        failTotal += 1;
        if (failTotal === 3) return Promise.reject(new Error("vendor said no"));
        return Promise.resolve({ webp: flat, ledgerId: "fake-ledger" });
      },
    };
    const failed = await renderPanels(oneFails, PROMPTS, { signal: new AbortController().signal, meetingId: MEETING_ID });
    expect(failed).toEqual({ kind: "failed", reason: "render_failed" });
    expect(failTotal).toBe(6);
  });

  it("W2-COMIC-T6 (D58): limiter busy on every call yields limiter_busy and no bytes, using a fake and says so", async () => {
    const busy = {
      image: () => Promise.reject(new LimiterBusy(0)),
    };
    const outcome = await renderPanels(busy, PROMPTS, { signal: new AbortController().signal, meetingId: MEETING_ID });
    expect(outcome).toEqual({ kind: "limiter_busy" });
  });
});
