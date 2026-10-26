import { describe, expect, it } from "vitest";
import { toolsForPhase } from "./tools.js";

function toolNames(tools: ReturnType<typeof toolsForPhase>): string[] | undefined {
  return tools?.map((tool) => tool.function.name);
}

describe("tools per phase", () => {
  it("D37-T1: the fifth round offers no tools", () => {
    const tools = toolsForPhase("explore", 2, 5);

    expect(tools).toBeUndefined();
  });

  it("D42-T1: decide offers concede and hold only", () => {
    const tools = toolsForPhase("decide", 2, 1);

    expect(toolNames(tools)).toEqual(["concede", "hold"]);
  });

  it("D35-T1: ask_my_human is absent when the budget is zero", () => {
    const tools = toolsForPhase("open", 0, 1);

    expect(toolNames(tools)).toEqual(["recall"]);
  });

  it("D35-T2: open and explore offer recall and ask when budget remains", () => {
    const tools = toolsForPhase("open", 1, 1);

    expect(toolNames(tools)).toEqual(["recall", "ask_my_human"]);
    expect(tools?.every((tool) => tool.function.parameters.additionalProperties === false)).toBe(true);
  });
});
