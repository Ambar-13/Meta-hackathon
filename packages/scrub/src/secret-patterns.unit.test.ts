import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  applyPatternRule,
  JWT,
  PEM_PRIVATE_KEY,
  SECRET_ASSIGNMENT,
  URL_WITH_CREDENTIALS,
} from "./secret-patterns.js";

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

// Applies one rule to a single free piece of text.
function apply(text: string, rule: Parameters<typeof applyPatternRule>[1]) {
  return applyPatternRule([{ text, isProtected: false, category: null }], rule);
}

describe("applyPatternRule and the secret rules", () => {
  it("R2.2-T2: a credentials URL stops before the full stop", () => {
    expect(apply("https://user:pa55@example.com/path.", URL_WITH_CREDENTIALS)).toEqual([
      {
        text: "https://user:pa55@example.com/path",
        isProtected: true,
        category: "url_credentials",
      },
      { text: ".", isProtected: false, category: null },
    ]);
  });

  it("R2.2-T3: a URL with no password is no credentials URL", () => {
    expect(apply("see https://example.com/a", URL_WITH_CREDENTIALS)).toEqual([
      { text: "see https://example.com/a", isProtected: false, category: null },
    ]);
  });

  it("R2.2-T4: a JWT needs three parts of at least 8 characters", async () => {
    expect(apply("token eyJabc.eyJdef.ghi end", JWT)).toEqual([
      { text: "token eyJabc.eyJdef.ghi end", isProtected: false, category: null },
    ]);
    const planted = await readFile(
      new URL("../fixtures/planted-secrets.ndjson", import.meta.url),
      "utf8",
    );
    const line = itemAt(planted.split("\n"), 4);
    const jwt = (JSON.parse(line) as { secret: string }).secret;
    expect(apply(`x ${jwt} y`, JWT)).toContainEqual({
      text: jwt,
      isProtected: true,
      category: "jwt",
    });
  });

  it("R2.2-T5: an unterminated private key block runs to the end", () => {
    const input =
      "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA\nmore lines";
    expect(apply(input, PEM_PRIVATE_KEY)).toEqual([
      { text: input, isProtected: true, category: "secret" },
    ]);
  });

  it("R2.2-T6: an assignment replaces only the value, needs capitals, and needs 4 characters", () => {
    expect(apply('API_KEY="abcd efgh" ok', SECRET_ASSIGNMENT)).toEqual([
      { text: "API_KEY=", isProtected: false, category: null },
      { text: '"abcd efgh"', isProtected: true, category: "secret" },
      { text: " ok", isProtected: false, category: null },
    ]);
    expect(apply("api_key=abcdefgh ok", SECRET_ASSIGNMENT)).toEqual([
      { text: "api_key=abcdefgh ok", isProtected: false, category: null },
    ]);
    expect(apply("MONKEY=abc ok", SECRET_ASSIGNMENT)).toEqual([
      { text: "MONKEY=abc ok", isProtected: false, category: null },
    ]);
  });

  it("R2.2-T26: a setting whose name has no secret word is skipped, and the next setting is still read", () => {
    expect(apply("NAME=abcdefgh", SECRET_ASSIGNMENT)).toEqual([
      { text: "NAME=abcdefgh", isProtected: false, category: null },
    ]);
    expect(apply("ENV=X_KEY=abcdefgh", SECRET_ASSIGNMENT)).toContainEqual({
      text: "abcdefgh",
      isProtected: true,
      category: "secret",
    });
  });

  it("R2.2-T27: a text with neither = nor : never reaches the setting rule", () => {
    const text = "A_KEY" + " ".repeat(40) + "abcdefgh";
    expect(apply(text, SECRET_ASSIGNMENT)).toEqual([{ text, isProtected: false, category: null }]);
  });

  it("R2.2-T28: a URL with no :// is never read by the URL rule, even with a password-like shape", () => {
    expect(apply("user:pa/ss@host/db", URL_WITH_CREDENTIALS)).toEqual([
      { text: "user:pa/ss@host/db", isProtected: false, category: null },
    ]);
  });
});
