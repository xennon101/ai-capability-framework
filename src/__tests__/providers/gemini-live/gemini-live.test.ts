import { describe, expect, it } from "vitest";
import { createDefaultGeminiClient } from "../../../providers/gemini/index.js";

const liveEnabled = process.env.RUN_LIVE_GEMINI === "1";

describe.skipIf(!liveEnabled)("Gemini live runtime smoke", () => {
  it("requires live Gemini environment variables before running provider calls", () => {
    expect(process.env.GEMINI_API_KEY, "GEMINI_API_KEY is required").toBeTruthy();
    expect(process.env.AICF_GEMINI_MODEL, "AICF_GEMINI_MODEL is required").toBeTruthy();
  });

  it("can construct the optional Gemini client when configured", async () => {
    const client = await createDefaultGeminiClient({
      apiKey: process.env.GEMINI_API_KEY
    });

    expect(client.models.generateContent).toEqual(expect.any(Function));
  });
});
