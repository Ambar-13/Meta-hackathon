// The search-words call of a friend ask: the ask and the subject's summary topics go in, and the words the subject would have written
// come out, which the recall search then looks for instead of the ask's own words.
import { SearchWordsOutput, toStrictJsonSchema } from "@meet-first/contracts";
import { readPrompt } from "@meet-first/prompts";
import type { ModelCall } from "../cards/name-chunks.js";
import { escapeBlockText } from "../meetings/prompt-builder.js";

// The search-words call for one ask: the search-words prompt and the untrusted-data rules as the system message, then the ask and the
// subject's topics, each escaped, as the user message; (none) when the subject has no topics.
export function searchWordsCall(input: { askText: string; topics: readonly string[] }): ModelCall {
  const prompt = readPrompt("search-words");
  const rules = readPrompt("untrusted-data-rules");
  const topics =
    input.topics.length === 0
      ? ["(none)"]
      : input.topics.map((topic) => "- " + escapeBlockText(topic));
  return {
    callSite: "search_words",
    promptVersion: prompt.version,
    messages: [
      { role: "system", content: `${prompt.text}\n\n${rules.text}` },
      {
        role: "user",
        content: [
          "<ask>" + escapeBlockText(input.askText) + "</ask>",
          "<topics>",
          ...topics,
          "</topics>",
        ].join("\n"),
      },
    ],
    schema: toStrictJsonSchema(SearchWordsOutput, "search-words"),
  };
}

// The recall query a search-words reply gives: its words joined by spaces, or the ask's own text when the reply does not read.
export function searchQueryOf(reply: unknown, askText: string): string {
  const parsed = SearchWordsOutput.safeParse(reply);
  return parsed.success ? parsed.data.words.join(" ") : askText;
}
