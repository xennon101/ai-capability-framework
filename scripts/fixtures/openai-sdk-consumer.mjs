import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import OpenAI from "openai";
import { createOpenAIResponsesClientFromSdk, createOpenAISelectionClient, runOpenAIResponses } from "ai-capability-framework/openai";
import { createCapabilityDiscovery, createInMemoryDiscoveryBudget } from "ai-capability-framework/discovery";
import { createAicfProviderRun, DefaultContextBuilder } from "ai-capability-framework/runtime";

const usage = { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 2 } };
const message = text => ({ id: "message_synthetic", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] });
const response = output => ({ id: "response_synthetic", object: "response", status: "completed", output, usage });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const fingerprint = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export async function verifyOpenAiSdkConsumer() {
  const originalFetch = globalThis.fetch, requests = [], queue = [];
  let unexpectedNetwork = 0;
  globalThis.fetch = async () => { unexpectedNetwork++; throw new Error("Unexpected network access in SDK fixture."); };
  const transport = async (url, init) => {
    assert.equal(String(url), "https://example.com/v1/responses");
    const body = JSON.parse(init.body); requests.push({ body, signal: init.signal });
    const next = queue.shift(); assert(next, "SDK must not make an unplanned request or retry.");
    if (typeof next === "function") return next(init);
    return new Response(JSON.stringify(next.body ?? next), { status: next.httpStatus ?? 200, headers: { "content-type": "application/json", "x-request-id": "request_synthetic" } });
  };
  // A nonzero host default proves the framework's per-attempt maxRetries: 0 wins.
  const sdk = new OpenAI({ apiKey: "synthetic", baseURL: "https://example.com/v1", maxRetries: 2, fetch: transport });
  const client = createOpenAIResponsesClientFromSdk(sdk);
  const configuration = { provider: "openai", model: "synthetic-model", configurationId: "synthetic-sdk-compatibility" };
  const directory = path.dirname(fileURLToPath(import.meta.resolve("ai-capability-framework/package.json")));
  const schema = JSON.parse(await readFile(path.join(directory, "schemas/discovery/selection-response.schema.json"), "utf8"));
  const input = { messages: [{ role: "user", content: "Read ticket TCK-100." }], outputSchema: schema, maxInputTokens: 100,
    maxOutputTokens: 100, deadlineAt: Date.now() + 30_000, attempt: 1, runId: "run_synthetic", requestId: "request_synthetic" };
  const selection = createOpenAISelectionClient({ client, configuration, mock: true, inputTokenPreflight: () => 5 });
  try {
    const decision = { schema_version: "1.0", decisions: [{ query_id: "read-ticket", decision: "select", capability_id: "support.ticket.get", reason_code: "supported_candidate" }] };
    queue.push(response([message(JSON.stringify(decision))]));
    const selected = await selection.generateStructured(input);
    assert.deepEqual(JSON.parse(selected.output), decision);
    assert.deepEqual(selected.usage, { inputTokens: 10, outputTokens: 4, totalTokens: 14, cachedInputTokens: 3, reasoningTokens: 2 });
    const first = requests[0].body;
    assert.equal(first.text.format.strict, true);
    assert(first.text.format.schema.properties.decisions.items.anyOf);
    assert.equal(first.max_output_tokens, 100);
    assert.equal(first.truncation, "disabled");
    assert.equal(first.model, configuration.model);
    assert.deepEqual(first.tools, []);
    const beforeDenials = requests.length;
    const oversized = createOpenAISelectionClient({ client, configuration, mock: true, inputTokenPreflight: () => 101 });
    await assert.rejects(oversized.generateStructured(input), error => error.providerAttempts === 0);
    await assert.rejects(selection.generateStructured({ ...input, deadlineAt: Date.now() - 1 }), error => error.providerAttempts === 0);
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(selection.generateStructured({ ...input, signal: stopped.signal }), error => error.providerAttempts === 0);
    assert.equal(requests.length, beforeDenials);

    for (const failed of [
      { ...response([message("partial")]), status: "incomplete" },
      response([{ type: "message", content: [{ type: "refusal", refusal: "Synthetic refusal." }] }]),
      response([])
    ]) {
      queue.push(failed);
      await assert.rejects(selection.generateStructured(input), error => error.providerAttempts === 1 && error.completedResponses === 1 && error.usage.totalTokens === 14);
    }
    const beforeFailure = requests.length;
    queue.push({ httpStatus: 503, body: { error: { type: "synthetic_error", message: "Synthetic transport failure." } } });
    await assert.rejects(selection.generateStructured(input), error => error.providerAttempts === 1 && error.completedResponses === 0 && error.usage.totalTokens === undefined);
    assert.equal(requests.length, beforeFailure + 1);

    let started; const entered = new Promise(resolve => { started = resolve; });
    queue.push(init => { started(); return new Promise((_, reject) => {
      const abort = () => reject(new DOMException("Synthetic cancellation.", "AbortError"));
      if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
    }); });
    const controller = new AbortController(), pending = selection.generateStructured({ ...input, signal: controller.signal });
    await entered; controller.abort();
    await assert.rejects(pending, error => error.providerAttempts === 1 && error.completedResponses === 0);
    assert(requests.at(-1).signal.aborted);

    const { createCustomerHarness } = await import(pathToFileURL(path.join(directory, "examples/12-capability-discovery-selection/customer-harness.mjs")).href);
    const ordinary = [];
    for (const narrationFails of [false, true]) {
      const harness = await createCustomerHarness(), userInput = { text: "Read ticket TCK-100." };
      const budget = createInMemoryDiscoveryBudget({ runId: harness.runtimeContext.runId, maxProviderCalls: 2, maxInputTokens: 200, maxOutputTokens: 200 });
      const providerRun = createAicfProviderRun({ runId: harness.runtimeContext.runId, budget, deadlineAt: Date.now() + 30_000 });
      const discovery = createCapabilityDiscovery({ registry: harness.registry });
      const [found] = await discovery.search({ tasks: [{ id: "read-ticket", text: userInput.text }], runtimeContext: harness.runtimeContext, providerRun });
      const start = requests.length;
      queue.push(response([{ type: "function_call", id: "function_synthetic", call_id: "call_synthetic", name: "aicf_support_ticket_get", arguments: '{"ticket_id":"TCK-100"}' }]));
      queue.push(narrationFails ? { httpStatus: 503, body: { error: { type: "synthetic_error", message: "Synthetic narration failure." } } } : response([message("The ticket was read.")]));
      const result = await runOpenAIResponses({ ...harness, userInput, client, model: configuration.model, contextBuilder: new DefaultContextBuilder(),
        router: discovery.routerFor(found), providerRun, maxTurns: 3, maxToolCalls: 1,
        providerExecution: { configuration, mock: true, maxInputTokens: 100, maxOutputTokens: 100, inputTokenPreflight: () => 5 } });
      assert.equal(result.status, narrationFails ? "provider_error" : "completed");
      assert.equal(harness.readCalls.length, 1);
      assert.equal(result.toolResults.length, 1);
      assert.equal(result.toolResults[0].status, "success");
      assert.equal(requests.length - start, 2);
      assert.equal(requests[start + 1].body.previous_response_id, "response_synthetic");
      assert(requests[start + 1].body.input.some(item => item.type === "function_call_output" && item.call_id === "call_synthetic"));
      assert.equal(result.providerUsage.totals.providerAttempts, 2);
      assert.equal(result.providerUsage.totals.totalTokens.total, narrationFails ? null : 28);
      assert.equal(result.providerUsage.totals.totalTokens.knownSubtotal, narrationFails ? 14 : 28);
      if (!narrationFails) {
        assert.equal(result.providerUsage.totals.cachedInputTokens.total, 6);
        assert.equal(result.providerUsage.totals.reasoningTokens.total, 4);
      }
      ordinary.push({ status: result.status, reads: 1, attempts: 2, requestFingerprint: fingerprint(requests[start].body) });
    }
    assert.equal(queue.length, 0); assert.equal(unexpectedNetwork, 0);
    return { selectionRequestFingerprint: fingerprint(first), requests: requests.length, ordinary, unexpectedNetwork, transport: "injected" };
  } finally { globalThis.fetch = originalFetch; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyOpenAiSdkConsumer()));
