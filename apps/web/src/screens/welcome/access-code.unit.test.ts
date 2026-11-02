import { describe, expect, it } from "vitest";
import { withAccessCode } from "./access-code.js";

describe("access code in links", () => {
  it("R9.5-T7: an invite link gets the access code as ?access=, before its fragment and beside its other query, and stays as it is with no code", () => {
    expect(withAccessCode("https://meet-first.onrender.com/join/abc", "judges")).toBe("https://meet-first.onrender.com/join/abc?access=judges");
    expect(withAccessCode("https://meet-first.onrender.com/join#token123", "judges")).toBe("https://meet-first.onrender.com/join?access=judges#token123");
    expect(withAccessCode("https://meet-first.onrender.com/join/abc?card=1", "a b")).toBe("https://meet-first.onrender.com/join/abc?card=1&access=a+b");
    expect(withAccessCode("https://meet-first.onrender.com/join/abc", "")).toBe("https://meet-first.onrender.com/join/abc");
    // A link this page cannot read is shown as the server sent it.
    expect(withAccessCode("not a link", "judges")).toBe("not a link");
  });
});
