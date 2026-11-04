import { describe, expect, it } from "vitest";
import { CARD_ITEMS_MIN, LISTING_LINE_MAX_CHARS } from "@meet-first/contracts";
import { normQuote, verifyQuote } from "@meet-first/receipts";
import { existsSync } from "node:fs";
import { PhotoKey } from "@meet-first/contracts";
import { SAMPLE_PEOPLE } from "./sample-people.js";
import { sampleFaceKey, samplePostPhoto } from "./sample-photos.js";

describe("the sample people", () => {
  it("W7-SAMPLE-T1: every item quotes its own note word for word, as the card job checks a quote", () => {
    const failures = SAMPLE_PEOPLE.flatMap((person) =>
      person.items.flatMap((item, index) => {
        const note = person.notes[item.note];
        const check =
          note === undefined
            ? null
            : verifyQuote({
                quote: item.quote,
                turnText: note,
                turnNormText: normQuote(note),
                forbidden: [],
              });
        return check?.ok === true ? [] : [`${person.displayName} item ${String(index + 1)}`];
      }),
    );

    expect(failures).toEqual([]);
  });

  it("W7-SAMPLE-T2: six people with different first names, each with a full card, four public items, a line that fits and one or two posts", () => {
    expect(SAMPLE_PEOPLE).toHaveLength(6);
    expect(new Set(SAMPLE_PEOPLE.map((person) => person.displayName)).size).toBe(6);
    for (const person of SAMPLE_PEOPLE) {
      expect(person.displayName).toMatch(/^[A-Z][a-z]+$/);
      expect(person.items.length).toBeGreaterThanOrEqual(CARD_ITEMS_MIN);
      expect(person.items.filter((item) => item.isPublic)).toHaveLength(4);
      expect(person.line.length).toBeLessThanOrEqual(LISTING_LINE_MAX_CHARS);
      expect(person.posts.length).toBeGreaterThanOrEqual(1);
      expect(person.posts.length).toBeLessThanOrEqual(2);
      expect(
        person.posts.every(
          (post) => post.text.length >= 1 && post.text.length <= 600 && post.hoursAgo > 0,
        ),
      ).toBe(true);
    }
  });

  it("W7-SAMPLE-T3: no sample text has a dash used as punctuation", () => {
    const texts = SAMPLE_PEOPLE.flatMap((person) => [
      person.line,
      ...person.notes,
      ...person.items.map((item) => item.claim),
      ...person.posts.map((post) => post.text),
    ]);

    expect(texts.filter((text) => /[\u2013\u2014]|\s-\s|--/.test(text))).toEqual([]);
  });

  it("W7-PHOTO-T6: each sample person has a face, each photo key fits the contract and has its picture in the web build, and each photo has its words", () => {
    const keys = SAMPLE_PEOPLE.flatMap((person) => [
      person.face,
      ...person.posts.flatMap((post) => (post.photo === undefined ? [] : [post.photo.key])),
    ]);

    expect(SAMPLE_PEOPLE.map((person) => person.face)).toEqual(
      SAMPLE_PEOPLE.map((person) => `faces/${person.displayName.toLowerCase()}`),
    );
    expect(keys.filter((key) => !PhotoKey.safeParse(key).success)).toEqual([]);
    expect(
      keys.filter(
        (key) =>
          !existsSync(new URL(`../../../../apps/web/src/look/samples/${key}.jpg`, import.meta.url)),
      ),
    ).toEqual([]);
    for (const post of SAMPLE_PEOPLE.flatMap((person) => person.posts)) {
      if (post.photo !== undefined) expect(post.photo.alt).toMatch(/^[A-Z].{9,298}\.$/);
    }
  });

  it("W7-PHOTO-T7: a face and a post's photo are found by the sample person's name and the post's words, and nothing for anyone or anything else", () => {
    const maya = SAMPLE_PEOPLE.find((person) => person.displayName === "Maya");
    const withPhoto = maya?.posts.find((post) => post.photo !== undefined);
    const withoutPhoto = maya?.posts.find((post) => post.photo === undefined);

    expect(sampleFaceKey("Maya")).toBe("faces/maya");
    expect(sampleFaceKey("Mira")).toBeNull();
    expect(samplePostPhoto("Maya", withPhoto?.text ?? "")).toEqual(withPhoto?.photo);
    expect(samplePostPhoto("Maya", withoutPhoto?.text ?? "")).toBeNull();
    expect(samplePostPhoto("Mira", withPhoto?.text ?? "")).toBeNull();
    expect(samplePostPhoto("Maya", "A post nobody wrote.")).toBeNull();
  });
});
