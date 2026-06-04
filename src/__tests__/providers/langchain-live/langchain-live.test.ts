import { describe, expect, it } from "vitest";
import { createDefaultLangChainToolFactory } from "../../../providers/langchain/index.js";

const liveEnabled = process.env.RUN_LIVE_LANGCHAIN === "1";

describe.skipIf(!liveEnabled)("LangChain live bridge smoke", () => {
  it("requires explicit opt-in before running LangChain bridge checks", () => {
    expect(process.env.RUN_LIVE_LANGCHAIN).toBe("1");
  });

  it("can construct the optional LangChain tool factory when configured", async () => {
    const factory = await createDefaultLangChainToolFactory();

    expect(factory.tool).toEqual(expect.any(Function));
  });
});
