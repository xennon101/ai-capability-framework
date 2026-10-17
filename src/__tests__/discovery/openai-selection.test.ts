import { describe, expect, it, vi } from "vitest";
import { createOpenAISelectionClient } from "../../openai/selection-client.js";
import { createOpenAIResponsesClientFromSdk } from "../../openai/tool-loop.js";
import { SELECTION_OUTPUT_SCHEMA } from "../../discovery/selection-response.js";

const configuration = { provider: "openai", model: "mock-model", configurationId: "test.responses.v1" };
const output = JSON.stringify({ schema_version: "1.0", decisions: [] });
function fixture(response: any = { status: "completed", output_text: output, usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 1 } } }) {
  const create = vi.fn().mockResolvedValue(response), preflight = vi.fn(() => 20);
  const client = createOpenAISelectionClient({ client: { responses: { create } }, configuration, mock: true, inputTokenPreflight: preflight });
  const input = { runId: "run", requestId: "request", deadlineAt: Date.now() + 1000, attempt: 1,
    messages: [{ role: "user" as const, content: "untrusted data" }], outputSchema: SELECTION_OUTPUT_SCHEMA, maxInputTokens: 100, maxOutputTokens: 30 };
  return { create, preflight, client, input };
}
describe("explicit Responses selection adapter", () => {
  it("projects the transport schema, bounds output, disables retries and forwards cancellation", async () => {
    const f = fixture(), controller = new AbortController();
    const result = await f.client.generateStructured({ ...f.input, signal: controller.signal });
    expect(result).toMatchObject({ output, providerAttempts: 1, usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, cachedInputTokens: 4, reasoningTokens: 1 } });
    expect(f.create.mock.calls[0]?.[0]).toMatchObject({ max_output_tokens: 30, truncation: "disabled", store: false, tools: [], text: { format: { type: "json_schema", strict: true } } });
    expect(JSON.stringify(f.create.mock.calls[0]?.[0])).not.toContain('"oneOf"');
    expect(JSON.stringify(f.create.mock.calls[0]?.[0])).toContain('"anyOf"');
    expect(f.create.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal, maxRetries: 0 });
    expect(f.preflight.mock.calls[0]?.[0]).toMatchObject({ maxInputTokens: 100, history: [] });
  });
  it.each([101, -1, NaN, 1.5])("rejects token preflight %s before transport work", async count => {
    const f = fixture(); f.preflight.mockReturnValue(count);
    await expect(f.client.generateStructured(f.input)).rejects.toMatchObject({ providerAttempts: 0 });
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each([
    { status: "incomplete", output_text: output },
    { status: "failed", output_text: output },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "private refusal" }] }] },
    { status: "completed", output_text: "" }
  ])("fails safely for refused, incomplete or unexpected responses", async response => {
    const f = fixture({ ...response, usage: { input_tokens: 9 } });
    await expect(f.client.generateStructured(f.input)).rejects.toMatchObject({ providerAttempts: 1, completedResponses: 1, usage: { inputTokens: 9 } });
    expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("retains reported failed-attempt consumption and scrubs exception contents", async () => {
    const f = fixture(); f.create.mockRejectedValue(Object.assign(new Error("private payload"), { usage: { input_tokens: 8 } }));
    const error = await f.client.generateStructured(f.input).catch(error => error);
    expect(error).toMatchObject({ providerAttempts: 1, completedResponses: 0, usage: { inputTokens: 8 } });
    expect(error.message).not.toContain("private payload");
  });
  it("passes request options through the existing SDK boundary", async () => {
    const create = vi.fn().mockResolvedValue({});
    const client = createOpenAIResponsesClientFromSdk({ responses: { create } });
    const options = { maxRetries: 0, signal: new AbortController().signal, timeout: 100 };
    await client.responses.create({ model: "mock-model" }, options);
    expect(create).toHaveBeenCalledWith({ model: "mock-model" }, options);
  });

  it("rechecks the framework guard after token preflight without exposing raw guard errors", async () => {
    const f = fixture();
    await expect(f.client.generateStructured({ ...f.input, beforeProviderCall() { throw new Error("private guard detail"); } }))
      .rejects.toMatchObject({ providerAttempts: 0 });
    expect(f.create).not.toHaveBeenCalled();
  });
});
