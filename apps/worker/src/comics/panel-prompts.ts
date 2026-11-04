import type { Avatar, BriefPoint } from "@meet-first/contracts";
import type { ChatMessage } from "@meet-first/llm";

// The most headlines one comic carries: three groups of three lines from each of two briefs.
export const HEADLINES_MAX = 18;
// The style every panel shares. Changing it changes every comic, so it is a constant with its row.
export const STYLE_PREFIX =
  "Flat colour comic panel, thick clean outlines, soft daylight palette, friendly cartoon style, one scene, no text anywhere in the image";
// The words that replace each display name inside an image prompt.
const ONE_PERSON = "one person";
const THE_OTHER_PERSON = "the other person";

// Replaces each whole word equal to name, case-sensitive, with replacement; a name that is empty changes nothing.
function replaceWholeName(text: string, name: string, replacement: string): string {
  if (name === "") return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"),
    () => replacement,
  );
}

// Removes the leading HTML comment line that owns a prompt file's header, so the header never reaches a model or an image.
function withoutLeadingComment(text: string): string {
  return text.replace(/^<!--[\s\S]*?-->\s*/, "");
}

// The supported brief lines from both briefs, texts only, deduplicated, at most 18. Unsupported or unverified lines never enter the comic.
export function pickHeadlines(
  briefs: { agree: BriefPoint[]; clash: BriefPoint[]; decideFirst: BriefPoint[] }[],
): string[] {
  const ordered = (["agree", "clash", "decideFirst"] as const).flatMap((group) =>
    briefs.flatMap((brief) => brief[group]),
  );
  const headlines: string[] = [];
  for (const point of ordered) {
    if (point.supported !== true || !point.quotes.every((quote) => quote.verified)) continue;
    if (headlines.includes(point.text)) continue;
    headlines.push(point.text);
  }
  return headlines.slice(0, HEADLINES_MAX);
}

// The two messages for the comic-panels call: the system text, and a user message with the question, the two characters and the headlines. Display names become A and B.
export function buildPanelsPromptInput(input: {
  questionText: string;
  avatarA: Avatar;
  avatarB: Avatar;
  headlines: string[];
  displayNames: { a: string; b: string };
  promptText: string;
}): ChatMessage[] {
  const headlineLines = input.headlines.map(
    (headline) =>
      `- ${replaceWholeName(replaceWholeName(headline, input.displayNames.a, "A"), input.displayNames.b, "B")}`,
  );
  const userMessage = [
    `<question>${input.questionText}</question>`,
    `<characters>A: ${input.avatarA}; B: ${input.avatarB}</characters>`,
    "<headlines>",
    ...headlineLines,
    "</headlines>",
  ].join("\n");
  return [
    { role: "system", content: input.promptText },
    { role: "user", content: userMessage },
  ];
}

// Fills the comic-image template once per panel: the style prefix, both avatar descriptors, the panel number and the panel's image prompt. Display names are replaced first.
export function buildImagePrompts(input: {
  panels: { caption: string; image_prompt: string }[];
  avatarA: Avatar;
  avatarB: Avatar;
  displayNames: { a: string; b: string };
  templateText: string;
}): string[] {
  const template = withoutLeadingComment(input.templateText);
  return input.panels.map((panel, index) => {
    const imagePrompt = replaceWholeName(
      replaceWholeName(panel.image_prompt, input.displayNames.a, ONE_PERSON),
      input.displayNames.b,
      THE_OTHER_PERSON,
    );
    const values: Record<string, string> = {
      style_prefix: STYLE_PREFIX,
      avatar_a: input.avatarA,
      avatar_b: input.avatarB,
      panel_number: String(index + 1),
      image_prompt: imagePrompt,
    };
    // One pass over the template, so text inserted for one token is never read again for another.
    return template.replace(
      /\{\{(style_prefix|avatar_a|avatar_b|panel_number|image_prompt)\}\}/g,
      (token: string, name: string) => values[name] ?? token,
    );
  });
}
