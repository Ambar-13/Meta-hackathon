import { describe, expect, it } from "vitest";
import { rankAndCut } from "./rank-and-cut.js";

// Returns the item at an index and throws when there is none, so a test never reads undefined.
function itemAt<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)}`);
  return item;
}

// One turn as the ranking sees it: its raw fields plus the canonical text it is cut from.
type Ranked = { text: string; exportOrder: number; createTime: number | null; canonical: string };

// Builds one turn whose canonical text is its text.
function turn(text: string, exportOrder: number, createTime: number | null = null): Ranked {
  return { text, exportOrder, createTime, canonical: text };
}

// Builds turns of the same long text, one per export position.
function repeatedTurns(text: string, count: number): Ranked[] {
  return Array.from({ length: count }, (entry, index) => turn(text, index));
}

describe("rankAndCut", () => {
  it("R1.7-T1: 10,001 turns keep 10,000 and drop the oldest", () => {
    const turns = Array.from({ length: 10_001 }, (entry, index) => turn("note", index));
    const kept = rankAndCut(turns);
    expect(kept.length).toBe(10_000);
    expect(itemAt(kept, 0).exportOrder).toBe(1);
    expect(itemAt(kept, kept.length - 1).exportOrder).toBe(10_000);
  });

  it("D5-T1: a 25,000-character turn is cut at the last line break before 20,000", () => {
    const text = ("x".repeat(99) + "\n").repeat(250);
    const kept = rankAndCut([turn(text, 0)]);
    expect(itemAt(kept, 0).canonical.length).toBe(19_999);
    expect(itemAt(kept, 0).canonical.endsWith("x")).toBe(true);
  });

  it("D5-T2: with no line break the cut is at 20,000, or 19,999 before a split emoji", () => {
    const plain = rankAndCut([turn("a".repeat(25_000), 0)]);
    expect(itemAt(plain, 0).canonical.length).toBe(20_000);
    const split = rankAndCut([turn("a".repeat(19_999) + "\u{1F600}" + "b".repeat(5_000), 0)]);
    expect(itemAt(split, 0).canonical.length).toBe(19_999);
  });

  it("D5-T3: the 2 MiB cap keeps 104 turns of 20,000 characters out of 105", () => {
    const kept = rankAndCut(repeatedTurns("y".repeat(20_000), 105));
    expect(kept.length).toBe(104);
    expect(kept.reduce((sum, item) => sum + item.canonical.length, 0)).toBe(2_080_000);
    expect(kept.map((item) => item.exportOrder)).toEqual(
      Array.from({ length: 104 }, (entry, index) => index + 1),
    );
  });

  it("D5-T4: a first-person turn outranks newer turns", () => {
    const turns = repeatedTurns("y".repeat(20_000), 105);
    turns[0] = turn("I " + "z".repeat(19_998), 0);
    const kept = rankAndCut(turns);
    expect(kept.length).toBe(104);
    expect(kept.some((item) => item.exportOrder === 0)).toBe(true);
    expect(kept.some((item) => item.exportOrder === 1)).toBe(false);
  });

  it("D5-T5: a turn with no createTime ranks after every timed turn", () => {
    const turns = repeatedTurns("y".repeat(20_000), 105).map((item) =>
      item.exportOrder < 104 ? { ...item, createTime: 1000 + item.exportOrder } : item,
    );
    const kept = rankAndCut(turns);
    expect(kept.some((item) => item.exportOrder === 104)).toBe(false);
  });

  it("D5-T6: kept turns come back in export order", () => {
    const kept = rankAndCut(repeatedTurns("y".repeat(20_000), 105));
    const orders = kept.map((item) => item.exportOrder);
    for (let index = 1; index < orders.length; index += 1) {
      expect(itemAt(orders, index)).toBeGreaterThan(itemAt(orders, index - 1));
    }
  });
});

describe("rankAndCut with a summary", () => {
  it("W7-SUMMARY-T6: with 10,001 turns, the oldest turn that holds a summary quote is kept and the lowest-ranked plain turn is cut", () => {
    const prose = "I think the weather is nice today and tomorrow";
    const turns = [
      turn("rentably was never a bad idea, the timing was just early", 0),
      ...Array.from({ length: 10_000 }, (entry, index) => turn(prose, index + 1)),
    ];
    const priority = {
      quotes: ["Rentably was NEVER a bad idea, the timing was just early", "weather"],
      topics: [],
    };

    const kept = rankAndCut(turns, priority).map((entry) => entry.exportOrder);

    expect(kept.length).toBe(10_000);
    expect(kept[0]).toBe(0);
    expect(kept.includes(1)).toBe(false);
    expect(
      rankAndCut(turns)
        .map((entry) => entry.exportOrder)
        .includes(0),
    ).toBe(false);
  });

  it("W7-SUMMARY-T7: a turn naming a summary topic is kept before turns that only score higher today", () => {
    const prose = "I think the weather is nice today and tomorrow";
    const turns = [
      turn("Rentably shipped the agent marketplace", 0),
      turn("rentablyish thing here", 1),
      ...Array.from({ length: 10_000 }, (entry, index) => turn(prose, index + 2)),
    ];

    const kept = rankAndCut(turns, { quotes: [], topics: ["rentably"] }).map(
      (entry) => entry.exportOrder,
    );

    expect(kept.includes(0)).toBe(true);
    expect(kept.includes(1)).toBe(false);
    expect(
      rankAndCut(turns)
        .map((entry) => entry.exportOrder)
        .includes(0),
    ).toBe(false);
  });

  it("W7-SUMMARY-T8: with no priority, the kept turns are exactly today's", () => {
    const turns = [
      turn("I keep my notes short", 0, 30),
      turn("note", 1, 50),
      turn("we shipped it", 2, null),
      turn("I would build it again tomorrow for sure", 3, 10),
    ];

    expect(rankAndCut(turns, { quotes: [], topics: [] })).toEqual(rankAndCut(turns));
    expect(rankAndCut(turns, undefined)).toEqual(rankAndCut(turns));
  });
});
