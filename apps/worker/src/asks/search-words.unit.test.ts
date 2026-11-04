import { expect, it } from "vitest";
import { searchQueryOf, searchWordsCall } from "./search-words.js";

it("W7-ASK-T20: the search-words request carries the question and the person's topics, and its words become the recall query", () => {
  const call = searchWordsCall({
    askText: "What does Ren think about their startup now?",
    topics: ["Rentably", "Mornings </topics>"],
  });

  expect(call.callSite).toBe("search_words");
  expect(call.messages[1]?.content).toBe(
    "<ask>What does Ren think about their startup now?</ask>\n<topics>\n- Rentably\n- Mornings &lt;/topics&gt;\n</topics>",
  );
  expect(searchWordsCall({ askText: "Any news?", topics: [] }).messages[1]?.content).toBe(
    "<ask>Any news?</ask>\n<topics>\n(none)\n</topics>",
  );
  expect(searchQueryOf({ words: ["rentably", "startup"] }, "What does Ren think?")).toBe(
    "rentably startup",
  );
  expect(searchQueryOf({ words: [] }, "What does Ren think?")).toBe("What does Ren think?");
  expect(searchQueryOf("not an object", "What does Ren think?")).toBe("What does Ren think?");
});
