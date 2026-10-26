import { describe, expect, it } from "vitest";
import { shannonEntropy } from "./entropy.js";
import { scrub } from "./scrub.js";

describe("entropy rule", () => {
  it("D12-T1: shannonEntropy gives the textbook values", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("ab")).toBe(1);
    expect(shannonEntropy("abcd")).toBe(2);
    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("AKIAZ7XQ4M2PLW9RT3VB")).toBeCloseTo(4.2219, 4);
  });

  it("D12-T2: a 20-character key is replaced and its full stop kept", () => {
    expect(scrub("The key is AKIAZ7XQ4M2PLW9RT3VB.", { allowlist: [] }).text).toBe(
      "The key is [redacted:secret:00000001].",
    );
  });

  it("D12-T3: a 19-character token is left alone however random", () => {
    expect(scrub("abcdefghijklmnopqrs is 19", { allowlist: [] }).text).toBe("abcdefghijklmnopqrs is 19");
  });

  it("D12-T4: a long English word under 3.5 bits is left alone", () => {
    expect(scrub("I love counterrevolutionaries a lot", { allowlist: [] }).text).toBe(
      "I love counterrevolutionaries a lot",
    );
  });

  it("D12-T5: a long Tamil word is left alone because it is not ASCII", () => {
    const text = "நான் செய்துகொண்டிருக்கிறார்கள் என்று";
    expect(scrub(text, { allowlist: [] }).text).toBe(text);
  });

  it("D12-T6: a link of 20 or more characters is replaced as a secret", () => {
    expect(scrub("see https://example.com/a", { allowlist: [] }).text).toBe("see [redacted:secret:00000001]");
  });

  it("D17-T3: an allowlist entry of 2 characters protects nothing", () => {
    expect(scrub("The key is AKIAZ7XQ4M2PLW9RT3VB.", { allowlist: ["AK"] }).text).toBe(
      "The key is [redacted:secret:00000001].",
    );
  });
});
