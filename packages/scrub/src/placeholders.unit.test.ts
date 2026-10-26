import { describe, expect, it } from "vitest";
import { ContractError } from "@meet-first/contracts";
import { countPlaceholders, findPlaceholders, formatPlaceholder, isCategory, makePlaceholderCounter } from "./placeholders.js";

describe("placeholders", () => {
  it("D14-T5: the counter writes 8 hex digits and can start anywhere", () => {
    const fromOne = makePlaceholderCounter();
    expect(fromOne()).toBe("00000001");
    expect(fromOne()).toBe("00000002");
    const fromTwoFiftyFive = makePlaceholderCounter(255);
    expect(fromTwoFiftyFive()).toBe("000000ff");
    expect(fromTwoFiftyFive()).toBe("00000100");
  });

  it("D14-T6: the counter refuses past ffffffff", () => {
    const next = makePlaceholderCounter(0xffffffff);
    expect(next()).toBe("ffffffff");
    let thrown: unknown;
    try {
      next();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ContractError);
    expect(thrown).toMatchObject({ code: "placeholder_ids_exhausted", httpStatus: 413 });
  });

  it("D14-T7: formatPlaceholder and isCategory", () => {
    expect(formatPlaceholder("email", "0000000a")).toBe("[redacted:email:0000000a]");
    expect(isCategory("email")).toBe(true);
    expect(isCategory("foo")).toBe(false);
  });

  it("R2.5-T1: countPlaceholders counts known placeholders and code lines only", () => {
    expect(countPlaceholders("a [redacted:email:00000001] b [code: js, 2 lines] c [person:friend] [redacted:foo:12345678]")).toBe(2);
  });

  it("D14-T8: findPlaceholders lists kind, category and position in order", () => {
    expect(findPlaceholders("x [code: js, 2 lines] y [redacted:foo:12345678]")).toEqual([
      { kind: "code", category: "code", isKnownCategory: true, start: 2, end: 21 },
      { kind: "redacted", category: "foo", isKnownCategory: false, start: 24, end: 47 },
    ]);
  });
});
