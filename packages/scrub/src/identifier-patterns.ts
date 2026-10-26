import type { PatternRule } from "./secret-patterns.js";

// An email address: name characters, @, a domain with at least one dot, and an ending of 2 or more letters (R2.2). The character
// before the address is captured in group 1, so a match starts only where a run of name characters begins; the address itself is
// group 2. Without that start, every position inside a long run would rescan the run, which is quadratic. The rule runs only on
// text that holds an @.
export const EMAIL: PatternRule = {
  category: "email",
  group: 2,
  pattern: /(^|[^A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g,
  needs: ["@"],
};
// An IBAN: 2 capitals, 2 digits, then groups of 4 capitals or digits with optional spaces; kept only when the mod-97 check passes (R2.2).
export const IBAN: PatternRule = {
  category: "iban",
  group: 0,
  pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
  isValid: isValidIban,
};
// A card number: 13 to 19 digits with optional single spaces or hyphens, not inside a longer number; kept only when the Luhn check passes (R2.2).
export const CARD: PatternRule = {
  category: "card",
  group: 2,
  pattern: /(^|[^\d-])(\d(?:[ -]?\d){12,18})(?![\d-])/g,
  isValid: isValidCardNumber,
};
// An Aadhaar number: 12 digits in groups of 4, the first digit 2 to 9, the same separator twice (a space, a hyphen or none) (R2.2).
export const AADHAAR: PatternRule = {
  category: "aadhaar",
  group: 2,
  pattern: /(^|[^\d-])([2-9]\d{3}([ -]?)\d{4}\3\d{4})(?![\d-])/g,
};
// A Singapore NRIC or FIN: S, T, F, G or M, 7 digits, one letter, any case. No checksum, so a mistyped number is still caught (R2.2).
export const NRIC: PatternRule = { category: "nric", group: 0, pattern: /\b[STFGM]\d{7}[A-Z]\b/gi };
// An Indian PAN: 5 capitals, 4 digits, 1 capital (R2.2).
export const PAN: PatternRule = { category: "pan", group: 0, pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g };
// A Singapore postal code after "Singapore" or "S", as in Singapore 238823 or S(238823); only the 6 digits are replaced (R2.2).
export const POSTAL_SINGAPORE: PatternRule = {
  category: "postal",
  group: 1,
  pattern: /\b(?:singapore|s) ?\(?(\d{6})\)?(?!\d)/gi,
};
// A 5 or 6 digit code, with an optional -4 digit tail, after a label such as pincode, PIN, postcode or zip; only the code is replaced (R2.2).
// The spaces around the optional separator are bounded to 16, so a long run of spaces after a label cannot backtrack.
export const POSTAL_LABELLED: PatternRule = {
  category: "postal",
  group: 1,
  pattern: /\b(?:postal code|postcode|post code|pin code|pincode|pin|zip code|zip)[ \t]{0,16}(?:is|:|#|-)?[ \t]{0,16}(\d{5,6}(?:-\d{4})?)(?!\d)/gi,
};
// A US ZIP code after a two-letter state code, as in CA 94105; only the code is replaced (R2.2).
export const POSTAL_US: PatternRule = {
  category: "postal",
  group: 1,
  pattern: /\b(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]) (\d{5}(?:-\d{4})?)(?!\d)/g,
};
// A phone number in one of four forms (see below); kept only when isValidPhoneNumber agrees (R2.2).
export const PHONE: PatternRule = {
  category: "phone",
  group: 2,
  pattern: /(^|[^\w+])(\+\d{1,3}[ .-]?(?:\(\d{1,4\}\)[ .-]?)?\d{1,5}(?:[ .-]\d{1,5}){0,5}|\(\d{2,4}\)[ .-]?\d{2,5}(?:[ .-]\d{2,5}){0,3}|\d{2,5}(?:[ .-]\d{2,5}){1,4}|\d{8,12})(?!\w)/g,
  isValid: isValidPhoneNumber,
};
// The identifier rules in the order scrub applies them; postal codes go before phones so CA 94105-1234 stays a postal code (R2.2).
export const IDENTIFIER_RULES: readonly PatternRule[] = [EMAIL, IBAN, CARD, AADHAAR, NRIC, PAN, POSTAL_SINGAPORE, POSTAL_LABELLED, POSTAL_US, PHONE];

// The two date shapes a phone candidate may not have: 2026-10-26 and 26.10.2026 (any of - . / between the parts) (R2.2).
export const DATE_SHAPES: readonly RegExp[] = [/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/, /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/];

// True when a card candidate has 13 to 19 digits and passes the Luhn check.
export function isValidCardNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let position = 0; position < digits.length; position += 1) {
    let digit = Number(digits.charAt(digits.length - 1 - position));
    if (position % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// True when an IBAN candidate has 15 to 34 characters without spaces and passes the mod-97 check.
export function isValidIban(value: string): boolean {
  const compact = value.replace(/ /g, "");
  if (compact.length < 15 || compact.length > 34) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (let start = 0; start < digits.length; start += 7) {
    remainder = Number(String(remainder) + digits.slice(start, start + 7)) % 97;
  }
  return remainder === 1;
}

// True when a phone candidate is not a date and has 8 to 15 digits when it starts with +, or 8 to 12 digits otherwise.
export function isValidPhoneNumber(value: string): boolean {
  if (DATE_SHAPES.some((shape) => shape.test(value))) return false;
  const count = value.replace(/\D/g, "").length;
  if (value.startsWith("+")) return count >= 8 && count <= 15;
  return count >= 8 && count <= 12;
}
