import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { seededSample, sha256 } from "./seeded-sample.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

describe("seeded sample", () => {
  it("D28-T4: sha256 matches Node's crypto for empty, short, block-edge and long inputs", () => {
    const inputs = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "0f2b9d0c-4f0e-4f7e-9a63-5e8b2b1a9c11",
      "é".repeat(500),
    ];

    for (const input of inputs) {
      const expected = createHash("sha256").update(input, "utf8").digest("hex");
      expect(hex(sha256(new TextEncoder().encode(input)))).toBe(expected);
    }
  });

  it("D28-T5: the sample follows the written rule, checked against BigInt arithmetic done here", () => {
    const seedText = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const mask = (1n << 64n) - 1n;
    let state = BigInt(`0x${createHash("sha256").update(seedText).digest("hex").slice(0, 16)}`);
    const ids = Array.from({ length: 30 }, (value, index) => index + 1);
    for (let place = 29; place >= 1; place -= 1) {
      state = (state + 0x9e3779b97f4a7c15n) & mask;
      let mixed = ((state ^ (state >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
      mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & mask;
      const other = Number((mixed ^ (mixed >> 31n)) % BigInt(place + 1));
      [ids[place], ids[other]] = [ids[other] ?? 0, ids[place] ?? 0];
    }

    expect(seededSample(seedText, 10, 30)).toEqual(
      ids.slice(0, 10).sort((left, right) => left - right),
    );
  });

  it("D28-T6: card ids that differ only in their last digit still get different samples", () => {
    const first = seededSample("00000000-0000-4000-8000-00000000000a", 10, 30);
    const second = seededSample("00000000-0000-4000-8000-00000000000b", 10, 30);

    expect(first).not.toEqual(second);
  });
});
