import type { BriefPoint } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import { describe, expect, it } from "vitest";
import { buildImagePrompts, pickHeadlines } from "./panel-prompts.js";
import { checkPromptsWithScrubber } from "./render-comic-job.js";
import { renderPanels } from "./image-calls.js";
import type { ImageArgs } from "@meet-first/llm";

// A brief line for the tests: its text, its support flag and whether its one quote checked out.
function point(text: string, supported: boolean | null, isVerified: boolean): BriefPoint {
  return { text, supported, quotes: [{ text: "a quote", side: "a", turnId: "00000000-0000-4000-8000-000000000001", verified: isVerified }] };
}

// One panel of the model reply, as the image prompt builder reads it.
const PANEL_CAPTION = "A and B talk about the work.";

describe("comic panel prompts", () => {
  it("W2-COMIC-T1 (D65, R7.5): a scrubber hit on a final image prompt refuses the comic before any image call, using a fake llm client and says so", async () => {
    const calls: ImageArgs[] = [];
    const fakeLlm = {
      image: (args: ImageArgs) => {
        calls.push(args);
        return Promise.resolve({ webp: new Uint8Array(), ledgerId: "fake-ledger" });
      },
    };
    const panels = [0, 1, 2, 3, 4, 5].map((index) => ({ caption: PANEL_CAPTION, image_prompt: index === 2 ? "A and B talk, one of them writes to mira@example.com." : "A and B sit in a garden." }));
    const prompts = buildImagePrompts({ panels, avatarA: "fox in a hoodie", avatarB: "owl with round glasses", displayNames: { a: "Mira", b: "Ravi" }, templateText: readPrompt("comic-image").text });
    const check = checkPromptsWithScrubber(prompts);
    if (check.kind === "ok") await renderPanels(fakeLlm, check.prompts, { signal: new AbortController().signal, meetingId: "00000000-0000-4000-8000-000000000501" });
    expect(check).toMatchObject({ kind: "blocked", reason: "prompt_blocked" });
    expect(calls).toHaveLength(0);
  });

  it("W2-COMIC-T2 (R11.3): buildImagePrompts replaces both display names and fills all five tokens", () => {
    const panels = [0, 1, 2, 3, 4, 5].map((index) => ({ caption: PANEL_CAPTION, image_prompt: index === 2 ? "Mira and Ravi share a bench in a park." : "A and B sit in a garden." }));
    const prompts = buildImagePrompts({ panels, avatarA: "fox in a hoodie", avatarB: "owl with round glasses", displayNames: { a: "Mira", b: "Ravi" }, templateText: readPrompt("comic-image").text });
    const joined = prompts.join("\n");
    expect(joined).not.toContain("Mira");
    expect(joined).not.toContain("Ravi");
    expect(joined).toContain("A is fox in a hoodie");
    expect(joined).toContain("Panel 3 of 6");
    expect(joined).not.toContain("{{");
  });

  it("W2-COMIC-T3 (A1): pickHeadlines keeps only supported lines whose quotes all verified, deduplicated, at most 18", () => {
    const briefA = {
      agree: [point("Keep plans short.", true, true), point("Unsupported line.", false, true), point("Null support line.", null, true)],
      clash: [point("Unverified quote line.", true, false), point("Ships on Friday.", true, true)],
      decideFirst: [point("Keep plans short.", true, true)],
    };
    const briefB = { agree: [point("Pick one owner.", true, true)], clash: [], decideFirst: [] };
    expect(pickHeadlines([briefA, briefB])).toEqual(["Keep plans short.", "Pick one owner.", "Ships on Friday."]);
    const eighteen = Array.from("abcdefghijklmnopqr", (letter) => point(`Distinct line ${letter}.`, true, true));
    const full = { agree: eighteen.slice(0, 3), clash: eighteen.slice(3, 6), decideFirst: eighteen.slice(6, 9) };
    const other = { agree: eighteen.slice(9, 12), clash: eighteen.slice(12, 15), decideFirst: eighteen.slice(15, 18) };
    expect(pickHeadlines([full, other])).toHaveLength(18);
  });
});
