import { describe, expect, it } from "vitest";
import { friendsLinkName, requestCountWords } from "./social-rail-state.js";

describe("rail count words", () => {
  it("W7-WEB-A-U2: the request count reads 1 request or N requests, and the Friends link name carries it only from 1", () => {
    expect(requestCountWords(1)).toBe("1 request");
    expect(requestCountWords(2)).toBe("2 requests");
    expect(requestCountWords(12)).toBe("12 requests");
    expect(friendsLinkName(0)).toBe("Friends");
    expect(friendsLinkName(1)).toBe("Friends, 1 request");
    expect(friendsLinkName(2)).toBe("Friends, 2 requests");
  });
});
