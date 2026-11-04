import { expect, it } from "vitest";
import { readPrompt } from "@meet-first/prompts";
import { QUOTE_MIN_CHARS, QUOTE_MIN_CODE_POINTS_NO_SPACE } from "@meet-first/receipts";

it("W7-SUMMARY-T12: the copy prompt asks for quotes as long as the quote check needs", () => {
  const text = readPrompt("summary-request").text;

  expect(text).toContain(`at least ${String(QUOTE_MIN_CHARS)} characters, or at least ${String(QUOTE_MIN_CODE_POINTS_NO_SPACE)} in a language written without spaces`);
  expect(text).not.toContain("at least 6 words");
});
