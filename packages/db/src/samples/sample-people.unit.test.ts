import { describe, expect, it } from "vitest";
import { CARD_ITEMS_MIN, LISTING_LINE_MAX_CHARS } from "@meet-first/contracts";
import { normQuote, verifyQuote } from "@meet-first/receipts";
import { SAMPLE_PEOPLE } from "./sample-people.js";

describe("the sample people", () => {
  it("W7-SAMPLE-T1: every item quotes its own note word for word, as the card job checks a quote", () => {
    const failures = SAMPLE_PEOPLE.flatMap((person) => person.items.flatMap((item, index) => {
      const note = person.notes[item.note];
      const check = note === undefined ? null : verifyQuote({ quote: item.quote, turnText: note, turnNormText: normQuote(note), forbidden: [] });
      return check?.ok === true ? [] : [`${person.displayName} item ${String(index + 1)}`];
    }));

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
      expect(person.posts.every((post) => post.text.length >= 1 && post.text.length <= 600 && post.hoursAgo > 0)).toBe(true);
    }
  });

  it("W7-SAMPLE-T3: no sample text has a dash used as punctuation", () => {
    const texts = SAMPLE_PEOPLE.flatMap((person) => [person.line, ...person.notes, ...person.items.map((item) => item.claim), ...person.posts.map((post) => post.text)]);

    expect(texts.filter((text) => /[\u2013\u2014]|\s-\s|--/.test(text))).toEqual([]);
  });
});
