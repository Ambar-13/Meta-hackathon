import { describe, expect, it } from "vitest";
import { toolsForPhase } from "./tools.js";

function toolNames(tools: ReturnType<typeof toolsForPhase>): string[] | undefined {
  return tools?.map((tool) => tool.function.name);
}

describe("tools per phase", () => {
  it("D37-T1: the fifth round offers no tools", () => {
    const tools = toolsForPhase("explore", 5);

    expect(tools).toBeUndefined();
  });

  it("D42-T1: decide offers concede and hold only", () => {
    const tools = toolsForPhase("decide", 1);

    expect(toolNames(tools)).toEqual(["concede", "hold"]);
  });

  it("D38-T1: open and explore offer recall only, with strict parameters", () => {
    const open = toolsForPhase("open", 1);
    const explore = toolsForPhase("explore", 4);

    expect(toolNames(open)).toEqual(["recall"]);
    expect(toolNames(explore)).toEqual(["recall"]);
    expect(open?.every((tool) => tool.function.parameters.additionalProperties === false)).toBe(true);
  });
});
