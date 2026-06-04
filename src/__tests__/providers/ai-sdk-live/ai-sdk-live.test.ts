import { describe, expect, it } from "vitest";
import { createDefaultAiSdkToolFactories } from "../../../providers/ai-sdk/index.js";

const liveEnabled = process.env.RUN_LIVE_AI_SDK === "1";

describe.skipIf(!liveEnabled)("AI SDK live bridge smoke", () => {
  it("requires a host-provided AI SDK model configuration before running provider calls", () => {
    expect(process.env.AICF_AI_SDK_MODEL, "AICF_AI_SDK_MODEL is required").toBeTruthy();
  });

  it("can construct optional AI SDK tool factories when configured", async () => {
    const factories = await createDefaultAiSdkToolFactories();

    expect(factories.tool).toEqual(expect.any(Function));
    expect(factories.jsonSchema).toEqual(expect.any(Function));
  });
});
