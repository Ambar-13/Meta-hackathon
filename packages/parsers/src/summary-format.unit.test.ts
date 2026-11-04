import { describe, expect, it } from "vitest";
import { SUMMARY_MAX_POINTS, SUMMARY_QUOTES_MAX } from "@meet-first/contracts";
import { formatSummary, parseSummary, summaryPriority } from "./summary-format.js";

// A summary in the fixed format, as the copy prompt asks a person's AI to write it.
const PLAIN = [
  "Kind: view",
  "Topic: Rentably",
  "Point: Rentably was never a bad idea.",
  "Strength: strong",
  "Quote: rentably was never a bad idea, the timing was just early",
  "Quote: i'd build it again tomorrow",
  "",
  "Kind: habit",
  "Topic: Mornings",
  "Point: Writes before checking messages.",
  "Strength: mild",
  "Quote: i write for an hour before i open slack",
].join("\n");

// The two points PLAIN holds.
const PLAIN_POINTS = [
  {
    kind: "view", topic: "Rentably", point: "Rentably was never a bad idea.", strength: "strong",
    quotes: ["rentably was never a bad idea, the timing was just early", "i'd build it again tomorrow"],
  },
  { kind: "habit", topic: "Mornings", point: "Writes before checking messages.", strength: "mild", quotes: ["i write for an hour before i open slack"] },
];

// One block in the format, with the given point and quotes.
function block(point: string, quotes: readonly string[] = []): string {
  return ["Kind: value", "Topic: Work", `Point: ${point}`, "Strength: moderate", ...quotes.map((quote) => `Quote: ${quote}`)].join("\n");
}

describe("the summary format", () => {
  it("W7-SUMMARY-T1: parses the fixed format into points, with kind, topic, point, strength and up to three quotes", () => {
    expect(parseSummary(PLAIN)).toEqual(PLAIN_POINTS);
  });

  it("W7-SUMMARY-T2: reads blocks with bullets, numbers, bold field names and curly quote marks the same as plain ones", () => {
    const decorated = [
      "Here is the summary you asked for.",
      "",
      "1. **Kind:** view",
      "- **Topic:** Rentably",
      "* point: Rentably was never a bad idea.",
      "> **Strength**: strong",
      "- Quote: “rentably was never a bad idea, the timing was just early”",
      "- quote: \"i'd build it again tomorrow\"",
      "2. **Kind:** habit",
      "   **Topic:** Mornings",
      "   **Point:** Writes before checking messages.",
      "   **Strength:** mild",
      "   **Quote:** ‘i write for an hour before i open slack’",
    ].join("\n");

    expect(parseSummary(decorated)).toEqual(PLAIN_POINTS);
  });

  it("W7-SUMMARY-T3: drops blocks with no point, fills unknown kinds and strengths, keeps at most 80 points and 3 quotes each, and cuts long fields", () => {
    const odd = ["Kind: dreams", "Topic: Sleep", "Point: Naps after lunch.", "Strength: enormous"].join("\n");
    const noPoint = ["Kind: view", "Topic: Nothing", "Strength: strong"].join("\n");
    const many = Array.from({ length: SUMMARY_MAX_POINTS + 5 }, (value, index) => block(`Point number ${String(index)}.`)).join("\n\n");
    const quoted = block("Has many quotes.", ["first quote here", "second quote here", "third quote here", "fourth quote here"]);
    const long = ["Kind: view", `Topic: ${"t".repeat(80)}`, `Point: ${"p".repeat(400)}`, `Quote: ${"q".repeat(400)}`].join("\n");

    expect(parseSummary(`${odd}\n\n${noPoint}`)).toEqual([{ kind: "other", topic: "Sleep", point: "Naps after lunch.", strength: "moderate", quotes: [] }]);
    expect(parseSummary(many)).toHaveLength(SUMMARY_MAX_POINTS);
    expect(parseSummary(quoted)[0]?.quotes).toHaveLength(SUMMARY_QUOTES_MAX);
    const [cut] = parseSummary(long);
    expect([cut?.topic.length, cut?.point.length, cut?.quotes[0]?.length]).toEqual([60, 300, 300]);
  });

  it("W7-SUMMARY-T4: returns no points for text that is not in the format", () => {
    expect(parseSummary("I am a builder who likes quiet mornings and loud ideas.\nThat is all.")).toEqual([]);
    expect(parseSummary("")).toEqual([]);
  });

  it("W7-SUMMARY-T5: summaryPriority lists every quote and every distinct topic, in order", () => {
    const again = block("Talks about Rentably a lot.", ["rentably again and again"]).replace("Topic: Work", "Topic: rentably");

    expect(summaryPriority(parseSummary(`${PLAIN}\n\n${again}`))).toEqual({
      quotes: ["rentably was never a bad idea, the timing was just early", "i'd build it again tomorrow", "i write for an hour before i open slack", "rentably again and again"],
      topics: ["Rentably", "Mornings"],
    });
  });

  it("W7-SUMMARY-T11: numbered quote lines, dash bullets and a strength with a note read like the plain format", () => {
    const dash = "\u2013 ";
    const text = ["Kind: view", "Topic: Rentably", "Point: Rentably was never a bad idea.", "Strength: strong (said often)", "Quote 1: rentably was never a bad idea, the timing was just early", "Quote #2: i'd build it again tomorrow"].map((line) => dash + line).join("\n");
    const emDash = text.replaceAll("\u2013", "\u2014");

    const expected = [{ kind: "view", topic: "Rentably", point: "Rentably was never a bad idea.", strength: "strong", quotes: ["rentably was never a bad idea, the timing was just early", "i'd build it again tomorrow"] }];
    expect(parseSummary(text)).toEqual(expected);
    expect(parseSummary(emDash)).toEqual(expected);
  });

  it("W7-SUMMARY-T10: formatSummary writes points back in the fixed format, so parseSummary reads the same points again", () => {
    const points = parseSummary(PLAIN);
    const text = formatSummary(points);

    expect(parseSummary(text)).toEqual(points);
    expect(text.split("\n\n")).toHaveLength(points.length);
    expect(text.startsWith("Kind: view\nTopic: Rentably\nPoint: Rentably was never a bad idea.\nStrength: strong\nQuote: ")).toBe(true);
    expect(formatSummary([{ kind: "habit", topic: "", point: "Writes first.", strength: "mild", quotes: [] }])).toBe("Kind: habit\nPoint: Writes first.\nStrength: mild");
  });
});
