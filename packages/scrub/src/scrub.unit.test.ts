import { describe, expect, it } from "vitest";
import { makePlaceholderCounter } from "./placeholders.js";
import { assignPlaceholderIds, markExistingPlaceholders, scrub } from "./scrub.js";

describe("scrub", () => {
  it("D11-T1: the worked example replaces the email and the phone with ids 1 and 2", () => {
    expect(scrub("Mail priya.nair@example.com or call +65 9123 4567 today.", { allowlist: [] })).toEqual({
      text: "Mail [redacted:email:00000001] or call [redacted:phone:00000002] today.",
      redactions: [
        { category: "email", placeholderId: "00000001" },
        { category: "phone", placeholderId: "00000002" },
      ],
    });
  });

  it("D14-T1: ids keep counting across calls that share a counter", () => {
    const nextId = makePlaceholderCounter();
    expect(scrub("a@example.com", { allowlist: [], nextId }).text).toBe("[redacted:email:00000001]");
    expect(scrub("b@example.com", { allowlist: [], nextId }).text).toBe("[redacted:email:00000002]");
  });

  it("D14-T2: placeholders already in the text are kept and renumbered in text order", () => {
    const result = scrub("Old [redacted:email:0000000f] and [code: js, 3 lines] then c@example.com", { allowlist: [] });
    expect(result.text).toBe("Old [redacted:email:00000001] and [code: js, 3 lines] then [redacted:email:00000003]");
    expect(result.redactions).toEqual([
      { category: "email", placeholderId: "00000001" },
      { category: "code", placeholderId: "00000002" },
      { category: "email", placeholderId: "00000003" },
    ]);
  });

  it("D14-T3: a role token stays as it is and is no redaction", () => {
    const result = scrub("Ask [person:project-manager-at-work] tomorrow.", { allowlist: [] });
    expect(result.text).toBe("Ask [person:project-manager-at-work] tomorrow.");
    expect(result.redactions).toEqual([]);
  });

  it("R2.2-T1: a URL with a password is caught as url_credentials before the email rule sees it", () => {
    const result = scrub("Connect with postgres://u:pw@db.example.com/x now.", { allowlist: [] });
    expect(result.text).toBe("Connect with [redacted:url_credentials:00000001] now.");
    expect(result.redactions.length).toBe(1);
  });

  it("D17-T1: an allowlisted name shields a long word from the entropy rule", () => {
    const word = "Telekommunikationsdienstleister";
    expect(scrub(`I joined ${word} last spring.`, { allowlist: [] }).text).toBe(
      "I joined [redacted:secret:00000001] last spring.",
    );
    const shielded = scrub(`I joined ${word} last spring.`, { allowlist: [word] });
    expect(shielded.text).toBe(`I joined ${word} last spring.`);
    expect(shielded.redactions).toEqual([]);
  });

  it("D17-T2: an email holding the display name is still replaced", () => {
    expect(scrub("Reach ambar@example.com soon.", { allowlist: ["Ambar"] }).text).toBe(
      "Reach [redacted:email:00000001] soon.",
    );
  });

  it("R2.1-T1: the fenced env fixture leaves no DATABASE_URL= behind", async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(new URL("../fixtures/fenced-env.md", import.meta.url), "utf8");
    const result = scrub(text, { allowlist: [] });
    expect(result.text).toBe(
      "Here is the env file that broke my deploy:\n\n[code: bash, 3 lines]\n\nI moved it out of the repo after that.\n",
    );
    expect(result.redactions).toEqual([{ category: "code", placeholderId: "00000001" }]);
    expect(result.text).not.toContain("DATABASE_URL=");
    expect(result.text).not.toContain("hunter2");
  });

  it("D11-T2: scrubbing a scrubbed text again changes nothing", () => {
    const first = scrub("Mail priya.nair@example.com or call +65 9123 4567 today.", { allowlist: [] });
    const second = scrub(first.text, { allowlist: [] });
    expect(second).toEqual(first);
  });

  it("D14-T4: an empty text gives an empty result", () => {
    expect(scrub("", { allowlist: [] })).toEqual({ text: "", redactions: [] });
  });

  it("D14-T9: an unknown category stays free text when existing placeholders are marked", () => {
    expect(
      markExistingPlaceholders([{ text: "[redacted:foo:12345678] and [redacted:email:00000009]", isProtected: false, category: null }]),
    ).toEqual([
      { text: "[redacted:foo:12345678] and ", isProtected: false, category: null },
      { text: "[redacted:email:00000009]", isProtected: true, category: "email" },
    ]);
  });

  it("D14-T10: a code redaction's id lives only in the list", () => {
    const result = assignPlaceholderIds(
      [
        { text: "[code: js, 1 lines]", isProtected: true, category: "code" },
        { text: " and ", isProtected: false, category: null },
        { text: "x@example.com", isProtected: true, category: "email" },
      ],
      makePlaceholderCounter(),
    );
    expect(result).toEqual({
      text: "[code: js, 1 lines] and [redacted:email:00000002]",
      redactions: [
        { category: "code", placeholderId: "00000001" },
        { category: "email", placeholderId: "00000002" },
      ],
    });
  });
});
