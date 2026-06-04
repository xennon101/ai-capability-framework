import { describe, expect, it } from "vitest";
import { createDefaultAnthropicMessagesClient } from "../../../providers/anthropic/index.js";

const liveEnabled = process.env.RUN_LIVE_ANTHROPIC === "1";

describe.skipIf(!liveEnabled)("Anthropic live runtime smoke", () => {
  it("requires live Anthropic environment variables before running provider calls", () => {
    expect(process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required").toBeTruthy();
    expect(process.env.AICF_ANTHROPIC_MODEL, "AICF_ANTHROPIC_MODEL is required").toBeTruthy();
  });

  it("can construct the optional Anthropic client when configured", async () => {
    const client = await createDefaultAnthropicMessagesClient({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    expect(client.messages.create).toEqual(expect.any(Function));
  });
});
