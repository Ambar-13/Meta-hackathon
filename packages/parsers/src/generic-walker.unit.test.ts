import { describe, expect, it } from "vitest";
import { walkGeneric } from "./generic-walker.js";

describe("walkGeneric", () => {
  it("R1.9-T1: a shape nobody has seen still yields its user turns", () => {
    const root = {
      data: {
        threads: [
          {
            items: [
              { sender: "human", text: "I like quiet mornings." },
              { sender: "bot", text: "Noted." },
              { author: { role: "user" }, parts: ["Second", { x: 1 }, "line"] },
            ],
          },
        ],
      },
    };
    expect(walkGeneric(root).map((turn) => turn.text)).toEqual(["I like quiet mornings.", "Second\nline"]);
  });

  it("R1.9-T2: parts and text inside content are read", () => {
    const root = [
      { role: "user", content: { parts: ["from parts"] } },
      { role: "human", content: { text: "from text" } },
    ];
    expect(walkGeneric(root).map((turn) => turn.text)).toEqual(["from parts", "from text"]);
  });

  it("R1.9-T3: a kept object is not walked into", () => {
    const root = { role: "user", text: "outer", inner: { role: "user", text: "inner" } };
    expect(walkGeneric(root).map((turn) => turn.text)).toEqual(["outer"]);
  });

  it("R1.9-T4: an object deeper than 40 is not visited", () => {
    let forty: unknown = { role: "user", text: "deep" };
    for (let depth = 0; depth < 40; depth += 1) forty = { next: forty };
    let fortyOne: unknown = { role: "user", text: "deep" };
    for (let depth = 0; depth < 41; depth += 1) fortyOne = { next: fortyOne };
    expect(walkGeneric(forty).map((turn) => turn.text)).toEqual(["deep"]);
    expect(walkGeneric(fortyOne)).toEqual([]);
  });

  it("R1.9-T5: the walker never returns null", () => {
    expect(walkGeneric(7)).toEqual([]);
    expect(walkGeneric(null)).toEqual([]);
  });
});
