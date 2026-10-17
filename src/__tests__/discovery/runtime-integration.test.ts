import { describe, expect, it, vi } from "vitest";
import { createCapabilityDiscovery, createInMemoryDiscoveryBudget, RetrievalCapabilityRouter } from "../../discovery/index.js";
import { createAicfProviderRun } from "../../runtime/provider-run.js";
import { DefaultCapabilityRouter } from "../../runtime/router.js";
import { runOpenAIResponses } from "../../openai/responses-runner.js";
import { MockOpenAIResponsesClient, mockFunctionCallResponse, mockTextResponse } from "../../openai/testing.js";
import { toOpenAIResponsesToolName } from "../../index.js";
import { AicfMcpServer } from "../../mcp-server/server.js";
import { createOpenAILiveEvalRunner, runLiveEvalSuite } from "../../evals-live/live-eval-runner.js";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import { MockSelectionClient, selectedDecision, abstainedDecision, selectionResponse } from "../../../examples/12-capability-discovery-selection/mock-selection.mjs";

async function fixture() {
  const h = await createDiscoveryExample(), api = createCapabilityDiscovery({ registry: h.registry });
  const budget = createInMemoryDiscoveryBudget({ runId: h.runtimeContext.runId, maxProviderCalls: 8, maxInputTokens: 40_000, maxOutputTokens: 8000 });
  const run = createAicfProviderRun({ runId: h.runtimeContext.runId, budget, deadlineAt: Date.now() + 30_000 });
  const results = await api.search({ tasks: [{ id: "one", text: h.userInput.text }, { id: "two", text: "ticket refund" }], runtimeContext: h.runtimeContext, providerRun: run });
  const selection = new MockSelectionClient([selectionResponse(selectedDecision("one", "support.ticket.get"), abstainedDecision("two"))]);
  const batch = await api.select({ results, client: selection, maxInputTokens: 4000, maxOutputTokens: 1000 });
  const route = { registry: h.registry, builtContext: h.builtContext, userInput: h.userInput };
  const execution = { configuration: { provider: "openai", model: "mock-model", configurationId: "test.loop.v1" }, mock: true,
    maxInputTokens: 4000, maxOutputTokens: 1000, inputTokenPreflight: vi.fn(() => 100) };
  return { h, api, budget, run, results, selection, batch, route, execution };
}
const reported = (response: any) => ({ ...response, status: "completed", usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } });

describe("task-bound optional selection and ordinary runtime integration", () => {
  it("routes each batch task independently, rejects reconstruction, and never selects again", async () => {
    const f = await fixture();
    const router = f.api.routerFor(f.batch, "one");
    expect(router.route(f.route).items.map(item => item.capabilityId)).toEqual(["support.ticket.get"]);
    expect(router.revalidate!(f.route, router.route(f.route)).items).toHaveLength(1);
    expect(f.api.routerFor(f.batch, "two").route({ ...f.route, userInput: { text: "ticket refund" } }).items).toEqual([]);
    expect(router.route({ ...f.route, userInput: { text: "ticket refund" } }).items).toEqual([]);
    expect(() => f.api.routerFor(structuredClone(f.batch), "one")).toThrow("not issued");
    expect(() => f.api.routerFor(f.batch, "foreign")).toThrow("not issued");
    expect(f.selection.calls).toHaveLength(1);
  });
  it("accounts every ordinary turn once and provides full continuation context to preflight", async () => {
    const f = await fixture();
    const client = new MockOpenAIResponsesClient([reported(mockFunctionCallResponse({ name: toOpenAIResponsesToolName("support.ticket.get"), args: { ticket_id: "TCK-100" } })), reported(mockTextResponse("Read complete."))]);
    const result = await runOpenAIResponses({ ...f.h, router: f.api.routerFor(f.batch, "one"), model: "mock-model", client, providerExecution: f.execution });
    expect(result.status).toBe("completed"); expect(f.h.readCalls).toHaveLength(1);
    expect(result.providerUsage?.totals).toMatchObject({ providerAttempts: 2, inputTokens: { total: 40 }, totalTokens: { total: 50 } });
    expect(result.usage?.total_tokens).toBe(25);
    expect(f.run.snapshot().usage.totals).toMatchObject({ providerAttempts: 3, totalTokens: { total: 190 } });
    expect(f.execution.inputTokenPreflight.mock.calls.map(([input]: any) => input.history.length)).toEqual([0, 1]);
    expect(client.requests.every(request => request.max_output_tokens === 1000 && request.truncation === "disabled")).toBe(true);
  });
  it.each(["permission", "source", "task"])("prevents dispatch after %s changes during the ordinary model call", async kind => {
    const f = await fixture();
    const create = vi.fn(async () => {
      if (kind === "permission") f.h.runtimeContext.subject.permissions = [];
      if (kind === "source") f.h.registry.capabilities[0].manifest.model_description += " changed";
      if (kind === "task") f.h.userInput.text = "another task";
      return reported(mockFunctionCallResponse({ name: toOpenAIResponsesToolName("support.ticket.get"), args: { ticket_id: "TCK-100" } }));
    });
    const result = await runOpenAIResponses({ ...f.h, router: f.api.routerFor(f.batch, "one"), client: { responses: { create } }, model: "mock-model", providerExecution: f.execution });
    expect(result.status).not.toBe("completed"); expect(f.h.readCalls).toHaveLength(0); expect(create).toHaveBeenCalledTimes(1);
    expect(result.providerUsage?.totals.providerAttempts).toBe(1);
  });
  it.each(["selected", "abstained"])("integrates dedicated routing with %s outcomes and revalidates without another call", async status => {
    const f = await fixture(), queryId = f.h.runtimeContext.requestId;
    const client = new MockSelectionClient([selectionResponse(status === "selected" ? selectedDecision(queryId, "support.ticket.get") : abstainedDecision(queryId))]);
    const router = new RetrievalCapabilityRouter({ mode: "dedicated_selector", discovery: { mode: "lexical", policyVersion: "test.v1" },
      selection: { client, limits: { maxTasks: 8, maxInputCharacters: 32_000, maxInputTokens: 4000, maxOutputTokens: 1000, maxAttempts: 1 } } });
    const routed = await router.routeWithDiagnostics({ ...f.route, providerRun: f.run });
    expect(routed.slice.items).toHaveLength(status === "selected" ? 1 : 0);
    expect(routed.selectionBatch?.usage.totals.providerAttempts).toBe(1);
    router.revalidate({ ...f.route, providerRun: f.run }, routed.slice);
    expect(client.calls).toHaveLength(1);
    f.h.runtimeContext.subject.permissions = [];
    expect(router.revalidate({ ...f.route, providerRun: f.run }, routed.slice).items).toEqual([]);
  });
  it("uses task-bound routers through MCP list and call without discovery/model work", async () => {
    const f = await fixture();
    const server = new AicfMcpServer({ registry: f.h.registry, router: f.api.routerFor(f.batch, "one"), executor: f.h.executor,
      contextBuilder: f.h.contextBuilder, runtimeContextFactory: () => f.h.runtimeContext });
    const tools = await server.listTools({ userInput: f.h.userInput });
    expect(tools.tools).toHaveLength(1);
    const result = await server.callTool({ userInput: f.h.userInput, params: { name: tools.tools[0]!.name, arguments: { ticket_id: "TCK-100" } } });
    expect(result.isError).not.toBe(true); expect(f.h.readCalls).toHaveLength(1);
    expect(f.selection.calls).toHaveLength(1); expect(f.run.snapshot().usage.totals.providerAttempts).toBe(1);
    f.h.runtimeContext.subject.permissions = [];
    expect((await server.listTools({ userInput: f.h.userInput })).tools).toEqual([]);
  });
  it("passes per-case run scopes and complete usage through the mocked live-eval runner", async () => {
    const f = await fixture(), evalId = [...f.h.registry.evalById.keys()][0]!;
    const client = new MockOpenAIResponsesClient([reported(mockTextResponse("No tool needed."))]);
    const runner = createOpenAILiveEvalRunner({ client, model: "mock-model", providerExecution: f.execution });
    const factory = vi.fn(() => f.run);
    const results = await runLiveEvalSuite({ cases: [{ evalId, runtimeContext: f.h.runtimeContext, userInput: f.h.userInput }],
      contextBuilderFactory: () => f.h.contextBuilder, executor: f.h.executor, registry: f.h.registry, router: f.api.routerFor(f.batch, "one"), runner, providerRunFactory: factory });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(results[0]?.runResult?.providerUsage?.totals.providerAttempts).toBe(1);
  });

  it("does not buy an ordinary model turn for an already stale result or a selector abstention", async () => {
    const f = await fixture(), client = { responses: { create: vi.fn() } };
    f.h.runtimeContext.subject.permissions = [];
    const stale = await runOpenAIResponses({ ...f.h, router: f.api.routerFor(f.batch, "one"), model: "mock-model", client, providerExecution: f.execution });
    expect(stale.status).toBe("failed"); expect(client.responses.create).not.toHaveBeenCalled();
    const fresh = await fixture();
    const abstained = await runOpenAIResponses({ ...fresh.h, userInput: { text: "ticket refund" }, router: fresh.api.routerFor(fresh.batch, "two"),
      model: "mock-model", client, providerExecution: fresh.execution });
    expect(abstained.status).toBe("completed"); expect(client.responses.create).not.toHaveBeenCalled();
    expect(fresh.run.snapshot().usage.totals.providerAttempts).toBe(1);
  });

  it("rechecks authorization after asynchronous input-token preflight and before transport", async () => {
    const f = await fixture(), client = { responses: { create: vi.fn() } };
    const execution = { ...f.execution, inputTokenPreflight: async () => { f.h.runtimeContext.subject.permissions = []; return 100; } };
    const result = await runOpenAIResponses({ ...f.h, router: f.api.routerFor(f.batch, "one"), model: "mock-model", client, providerExecution: execution });
    expect(result.status).not.toBe("completed"); expect(client.responses.create).not.toHaveBeenCalled();
    expect(f.run.snapshot().usage.totals.providerAttempts).toBe(1);
  });

  it("retains known failed transport usage across the managed runner", async () => {
    const f = await fixture();
    const create = vi.fn().mockRejectedValue(Object.assign(new Error("private provider payload"), { usage: { input_tokens: 11, total_tokens: 11 } }));
    const result = await runOpenAIResponses({ ...f.h, router: f.api.routerFor(f.batch, "one"), model: "mock-model", client: { responses: { create } }, providerExecution: f.execution });
    expect(result.status).toBe("provider_error");
    expect(result.providerUsage?.totals).toMatchObject({ providerAttempts: 1, inputTokens: { total: 11 }, outputTokens: { total: null, complete: false } });
    expect(JSON.stringify(result)).not.toContain("private provider payload");
    expect(f.run.snapshot().usage.totals.inputTokens.knownSubtotal).toBe(131);
  });

  it("pins execution limits and refuses changes made during token preflight", async () => {
    const f = await fixture(), create = vi.fn();
    const execution = { ...f.execution, inputTokenPreflight: async () => { execution.maxInputTokens = 9000; return 100; } };
    const result = await runOpenAIResponses({ ...f.h, router: f.api.routerFor(f.batch, "one"), model: "mock-model", client: { responses: { create } }, providerExecution: execution });
    expect(result.status).not.toBe("completed"); expect(create).not.toHaveBeenCalled();
    expect(f.run.snapshot().usage.totals.providerAttempts).toBe(1);
  });

  it("honors an earlier runner deadline before dedicated routing can spend", async () => {
    const f = await fixture(), client = new MockSelectionClient([]);
    const router = new RetrievalCapabilityRouter({ mode: "dedicated_selector", discovery: { mode: "lexical", policyVersion: "test.v1" },
      selection: { client, limits: { maxTasks: 8, maxInputCharacters: 32_000, maxInputTokens: 4000, maxOutputTokens: 1000, maxAttempts: 1 } } });
    const create = vi.fn();
    const result = await runOpenAIResponses({ ...f.h, router, providerRun: f.run, deadlineAt: 1, model: "mock-model", client: { responses: { create } }, providerExecution: f.execution });
    expect(result.status).not.toBe("completed"); expect(client.calls).toHaveLength(0); expect(create).not.toHaveBeenCalled();
  });

  it("refuses a live-eval factory that reuses one invocation for a second case", async () => {
    const f = await fixture(), evalId = [...f.h.registry.evalById.keys()][0]!;
    const client = new MockOpenAIResponsesClient([reported(mockTextResponse("Complete."))]);
    const testCase = { evalId, runtimeContext: f.h.runtimeContext, userInput: f.h.userInput };
    const results = await runLiveEvalSuite({ cases: [testCase, testCase], contextBuilderFactory: () => f.h.contextBuilder,
      executor: f.h.executor, registry: f.h.registry, router: f.api.routerFor(f.batch, "one"), providerRunFactory: () => f.run,
      runner: createOpenAILiveEvalRunner({ client, model: "mock-model", providerExecution: f.execution }) });
    expect(results[1]?.status).toBe("errored"); expect(client.requests).toHaveLength(1);
  });

  it("honors run cancellation alongside a separate caller signal before returning a final response", async () => {
    const f = await fixture(), controller = new AbortController();
    const run = createAicfProviderRun({ runId: f.h.runtimeContext.runId, budget: f.budget, deadlineAt: Date.now() + 1000, signal: controller.signal });
    const result = await runOpenAIResponses({ ...f.h, providerRun: run, router: new DefaultCapabilityRouter(), signal: new AbortController().signal,
      client: new MockOpenAIResponsesClient([reported(mockTextResponse("Late final response."))]), model: "mock-model", providerExecution: f.execution,
      traceSink: { emit(event) { if (event.type === "model.call.end") controller.abort(); } } });
    expect(result.status).toBe("cancelled"); expect(result.finalText).toBe("");
    expect(result.providerUsage?.totals.providerAttempts).toBe(1);
  });
});
