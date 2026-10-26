import { describe, expect, it } from "vitest";
import { isValidCardNumber, isValidIban, isValidPhoneNumber } from "./identifier-patterns.js";
import { scrub } from "./scrub.js";

// Scrubs one text with an empty allowlist and returns the new text.
function scrubbed(text: string): string {
  return scrub(text, { allowlist: [] }).text;
}

describe("identifier patterns", () => {
  it("R2.2-T7: a 16-digit number failing Luhn is no card, and its first 12 digits are caught as aadhaar", () => {
    expect(scrubbed("Card 4111 1111 1111 1112 here")).toBe("Card [redacted:aadhaar:00000001] 1112 here");
  });

  it("R2.2-T8: an IBAN failing mod 97 is left alone", () => {
    expect(scrubbed("GB82 WEST 1234 5698 7654 33 wrong")).toBe("GB82 WEST 1234 5698 7654 33 wrong");
  });

  it("R2.2-T9: dates and times are no phones", () => {
    expect(scrubbed("On 2026-10-26 at 10:30 we met.")).toBe("On 2026-10-26 at 10:30 we met.");
    expect(scrubbed("On 26.10.2026 we met.")).toBe("On 26.10.2026 we met.");
  });

  it("R2.2-T10: a 12-digit number starting with 1 is a phone, not an Aadhaar", () => {
    expect(scrubbed("Number 1234 5678 9012 is not Aadhaar.")).toBe("Number [redacted:phone:00000001] is not Aadhaar.");
  });

  it("R2.2-T11: the postal rules replace only the code", () => {
    expect(scrubbed("S(238823) and s 123456 and Singapore 049145")).toBe(
      "S([redacted:postal:00000001]) and s [redacted:postal:00000002] and Singapore [redacted:postal:00000003]",
    );
    expect(scrubbed("PIN 560001 and zip code 10001")).toBe(
      "PIN [redacted:postal:00000001] and zip code [redacted:postal:00000002]",
    );
  });

  it("R2.2-T12: dotted local numbers and international numbers are phones", () => {
    expect(scrubbed("Call 415.555.0132 or +44 20 7946 0958")).toBe(
      "Call [redacted:phone:00000001] or [redacted:phone:00000002]",
    );
  });

  it("R2.2-T13: NRIC and PAN are caught", () => {
    expect(scrubbed("NRIC S1234567D and pan ABCDE1234F")).toBe(
      "NRIC [redacted:nric:00000001] and pan [redacted:pan:00000002]",
    );
  });

  it("R2.2-T14: the check functions agree with their rules", () => {
    expect(isValidCardNumber("4111 1111 1111 1111")).toBe(true);
    expect(isValidCardNumber("4111 1111 1111 1112")).toBe(false);
    expect(isValidCardNumber("4111")).toBe(false);
    expect(isValidIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(isValidIban("GB82 WEST 1234 5698 7654 33")).toBe(false);
    expect(isValidPhoneNumber("+65 9123 4567")).toBe(true);
    expect(isValidPhoneNumber("2026-10-26")).toBe(false);
    expect(isValidPhoneNumber("1234567")).toBe(false);
  });
});
