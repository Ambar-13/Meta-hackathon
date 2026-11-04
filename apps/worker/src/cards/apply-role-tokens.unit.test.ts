import { describe, expect, it } from "vitest";
import { ROLE_TOKEN } from "@meet-first/contracts";
import {
  applyRoleTokens,
  assignTokens,
  countToken,
  fitTurnLength,
  isAllowlisted,
  planTurnRewrites,
  roleText,
  sensitiveCategoriesFor,
  type NameToken,
} from "./apply-role-tokens.js";

const person = { displayName: "Tom Lee", affiliations: ["Kopi Club"] };

// One name token as the names pass would make it.
function token(text: string, role: string, isMinor = false): NameToken {
  return { text, role, token: ROLE_TOKEN(role), isMinor };
}

describe("isAllowlisted", () => {
  it("R2.3-T1: the display name, its words and the affiliations are allowlisted in any letter case", () => {
    for (const name of ["tom", "Lee", "TOM LEE", "kopi club"])
      expect(isAllowlisted(name, person)).toBe(true);
    for (const name of ["Tomás", "Priya"]) expect(isAllowlisted(name, person)).toBe(false);
  });
});

describe("applyRoleTokens", () => {
  it("R2.3-T2: a name is replaced as a whole word in any letter case, never inside another word", () => {
    expect(applyRoleTokens("Tom met tom at Tomorrow Labs.", [token("Tom", "manager")])).toBe(
      "[person:manager] met [person:manager] at Tomorrow Labs.",
    );
  });

  it("R2.3-T3: a longer name is replaced before its first name, and a token is not matched again", () => {
    expect(
      applyRoleTokens("Rohan Mehta and Rohan met.", [
        token("Rohan", "colleague 2"),
        token("Rohan Mehta", "colleague"),
      ]),
    ).toBe("[person:colleague] and [person:colleague 2] met.");
  });

  it("R2.3-T4: placeholders, code placeholders and role tokens are never rewritten", () => {
    const text =
      "Mail [redacted:email:3f9a1c2e] to Ana; [code: python, 12 lines] and [person:friend] stay.";
    expect(
      applyRoleTokens(text, [
        token("Ana", "colleague"),
        token("email", "person"),
        token("friend", "person"),
      ]),
    ).toBe(
      "Mail [redacted:email:3f9a1c2e] to [person:colleague]; [code: python, 12 lines] and [person:friend] stay.",
    );
  });

  it("R2.3-T5: a Chinese name is matched inside a sentence", () => {
    expect(applyRoleTokens("王伟说下周开会。", [token("王伟", "person")])).toBe(
      "[person:person]说下周开会。",
    );
  });
});

describe("assignTokens and roles", () => {
  it("R2.3-T6: assignTokens gives one token per name, first seen first, with a number for a role already taken", () => {
    const tokens = assignTokens([
      { text: "Rohan Mehta", role: "colleague" },
      { text: "rohan mehta", role: "friend" },
      { text: "Ana", role: "Colleague" },
      { text: "Meera", role: "child" },
      { text: "Arjun", role: "child" },
      { text: "  ", role: "person" },
    ]);
    expect(tokens).toEqual([
      { text: "Rohan Mehta", role: "colleague", token: "[person:colleague]", isMinor: false },
      { text: "Ana", role: "colleague 2", token: "[person:colleague 2]", isMinor: false },
      { text: "Meera", role: "child", token: "[person:child]", isMinor: true },
      { text: "Arjun", role: "child 2", token: "[person:child 2]", isMinor: true },
    ]);
  });

  it("R2.3-T7: roleText makes the role a token can hold", () => {
    expect(roleText("Team Lead")).toBe("team lead");
    expect(roleText("  ")).toBe("person");
    expect(roleText("Manager")).toBe("manager");
    expect(roleText("a[b]c")).toBe("a b c");
    expect(roleText("X".repeat(50))).toBe("x".repeat(40));
  });
});

describe("fitTurnLength and sensitive tags", () => {
  it("D15-T5: fitTurnLength cuts a rewritten turn back to 20,000 characters without splitting a token", () => {
    expect(fitTurnLength("a".repeat(15_000) + "\n" + "b".repeat(5_010))).toBe("a".repeat(15_000));
    const spaced = fitTurnLength("x ".repeat(10_001));
    expect(spaced.length).toBe(19_999);
    expect(spaced.endsWith("x")).toBe(true);
    expect(fitTurnLength("a".repeat(19_990) + "[person:manager]")).toBe("a".repeat(19_990));
    const exact = "a".repeat(20_000);
    expect(fitTurnLength(exact)).toBe(exact);
  });

  it("R2.8-T1: an address placeholder tags its turn address and an email placeholder does not", () => {
    const text = "near [redacted:address:0c4e8a91] and [redacted:email:3f9a1c2e]";
    expect(sensitiveCategoriesFor(text, [], false)).toEqual(["address"]);
    expect(sensitiveCategoriesFor(text, [], true)).toEqual(["address", "minor"]);
    expect(sensitiveCategoriesFor(text, ["health"], false)).toEqual(["address", "health"]);
  });
});

describe("planTurnRewrites and counts", () => {
  it("D18-T1: a child's name gets the child token, and its turn is tagged minor", () => {
    const [rewrite] = planTurnRewrites(
      [{ id: "t0", text: "My daughter Meera starts school.", sensitive_categories: [] }],
      [token("Meera", "child", true)],
    );
    expect(rewrite?.text).toBe("My daughter [person:child] starts school.");
    expect(rewrite?.occurrences).toEqual([1]);
    expect(rewrite?.categories).toEqual(["minor"]);
  });

  it("D15-T6: planTurnRewrites counts each token it wrote, turn by turn, and never one that was already there", () => {
    const rewrites = planTurnRewrites(
      [
        { id: "t0", text: "Ask Rohan and Rohan again.", sensitive_categories: [] },
        { id: "t1", text: "My son Arjun is six.", sensitive_categories: [] },
        {
          id: "t2",
          text: "Nothing new, [person:colleague] was here before.",
          sensitive_categories: [],
        },
      ],
      [token("Rohan", "colleague"), token("Arjun", "child", true)],
    );
    expect(rewrites[0]).toMatchObject({
      text: "Ask [person:colleague] and [person:colleague] again.",
      occurrences: [2, 0],
      isTextChanged: true,
      categories: [],
    });
    expect(rewrites[1]).toMatchObject({
      occurrences: [0, 1],
      categories: ["minor"],
      isCategoriesChanged: true,
    });
    expect(rewrites[2]).toMatchObject({
      occurrences: [0, 0],
      isTextChanged: false,
      isCategoriesChanged: false,
    });
  });

  it("R2.3-T8: countToken counts one token's occurrences and no other token's", () => {
    const text = "[person:colleague] and [person:colleague 2] and [person:colleague]";
    expect(countToken(text, "[person:colleague]")).toBe(2);
    expect(countToken(text, "[person:colleague 2]")).toBe(1);
    expect(countToken(text, "[person:child]")).toBe(0);
  });
});
