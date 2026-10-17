import { describe, expect, it, vi } from "vitest";
import { createAicfProviderRun } from "../../runtime/provider-run.js";
import { createCapabilityDiscovery, createInMemoryDiscoveryBudget } from "../../discovery/index.js";
import { createTraceEvent } from "../../observability/redaction.js";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import { MockSelectionClient, selectedDecision, selectionResponse } from "../../../examples/12-capability-discovery-selection/mock-selection.mjs";

const configuration = { provider: "mock", model: "mock-model", configurationId: "test.v1" };
const flush = () => new Promise<void>(done => setImmediate(done));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup(calls = 4, extra: Record<string, unknown> = {}) {
  const budget = createInMemoryDiscoveryBudget({ runId: "run_example", maxProviderCalls: calls, maxInputTokens: 1000, maxOutputTokens: 200, ...extra });
  const run = createAicfProviderRun({ runId: "run_example", budget, deadlineAt: Date.now() + 30_000 });
  const input = { requestId: "request_example", stage: "planning" as const, configuration, mock: true,
    maxInputTokens: 100, maxOutputTokens: 20,
    invoke: async () => ({ output: "planned", providerAttempts: 1, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } }),
    validate: (value: unknown) => ({ value: (value as { output: string }).output }) };
  return { run, budget, input };
}

describe("shared provider runs", () => {
  it("accounts planning and selection once, recovers its scope, and preserves stage receipts", async () => {
    const h = await createDiscoveryExample(), f = setup();
    await f.run.attempt(f.input);
    const api = createCapabilityDiscovery({ registry: h.registry });
    const results = await api.search({ tasks: [{ id: "one", text: "ticket" }], runtimeContext: h.runtimeContext, providerRun: f.run });
    const batch = await api.select({ results, client: new MockSelectionClient([selectionResponse(selectedDecision("one", "support.ticket.get"))]), maxInputTokens: 200, maxOutputTokens: 20 });
    expect(batch.outcomes[0]?.status).toBe("selected");
    expect(batch.usage.totals.providerAttempts).toBe(1);
    expect(f.run.snapshot().usage.totals.providerAttempts).toBe(2);
    expect(new Set(f.run.snapshot().usage.stages.map(item => item.attemptId)).size).toBe(2);
    expect(api.routerFor(batch, "one").providerRun).toBe(f.run);
    expect(f.run.snapshot().usage.totals.totalTokens.total).toBe(152);
    expect(f.run.snapshot().usage.totals.estimatedCost.complete).toBe(false);
  });

  it("shares an exhausted planning allowance with selector attempts", async () => {
    const h = await createDiscoveryExample(), f = setup(1);
    await f.run.attempt(f.input);
    const api = createCapabilityDiscovery({ registry: h.registry });
    const results = await api.search({ tasks: [{ id: "one", text: "ticket" }], runtimeContext: h.runtimeContext, providerRun: f.run });
    const client = new MockSelectionClient([selectionResponse(selectedDecision("one", "support.ticket.get"))]);
    const batch = await api.select({ results, client, maxInputTokens: 200, maxOutputTokens: 20 });
    expect(batch.outcomes[0]?.reasonCode).toBe("budget_denied");
    expect(client.calls).toHaveLength(0);
    expect(f.run.snapshot().usage.totals.providerAttempts).toBe(1);
  });

  it("records one explicit repair as a separate attempt without duplicating its shared batch receipt", async () => {
    const h = await createDiscoveryExample(), f = setup();
    const api = createCapabilityDiscovery({ registry: h.registry });
    const results = await api.search({ tasks: [{ id: "one", text: "ticket" }], runtimeContext: h.runtimeContext, providerRun: f.run });
    const client = new MockSelectionClient(["invalid JSON", selectionResponse(selectedDecision("one", "support.ticket.get"))]);
    const batch = await api.select({ results, client, maxInputTokens: 200, maxOutputTokens: 20, limits: { maxAttempts: 2 } });
    expect(batch.outcomes[0]?.status).toBe("selected");
    expect(batch.usage.totals).toMatchObject({ providerAttempts: 2, repairAttempts: 1, totalTokens: { total: 280 } });
    expect(f.run.snapshot().usage.totals).toMatchObject({ providerAttempts: 2, repairAttempts: 1, totalTokens: { total: 280 } });
    expect(new Set(f.run.snapshot().usage.stages.map(stage => stage.attemptId)).size).toBe(2);
  });

  it("reserves atomically for concurrent work and holds unknown output allowance", async () => {
    const f = setup(1), started = deferred<void>(), response = deferred<any>();
    const first = f.run.attempt({ ...f.input, invoke: async () => { started.resolve(); return response.promise; } });
    await started.promise;
    expect((await f.run.attempt(f.input)).code).toBe("budget_denied");
    response.resolve({ output: "done", providerAttempts: 1 });
    await first;
    expect(f.run.snapshot().usage.totals.inputTokens).toEqual({ total: null, knownSubtotal: 0, complete: false });
    const capped = setup(3, { maxOutputTokens: 20 });
    await capped.run.attempt({ ...capped.input, invoke: async () => ({ output: "unknown", providerAttempts: 1 }) });
    expect((await capped.run.attempt(capped.input)).code).toBe("budget_denied");
  });

  it.each(["cancel", "deadline"])("returns promptly for %s and observes late settlement without mutating snapshots", async kind => {
    const f = setup(), controller = new AbortController(), started = deferred<void>(), response = deferred<any>();
    const pending = f.run.attempt({ ...f.input, signal: controller.signal, deadlineAt: Date.now() + 80,
      invoke: async () => { started.resolve(); return response.promise; } });
    await started.promise;
    if (kind === "cancel") controller.abort();
    const result = await pending, before = JSON.stringify(result), snapshot = f.run.snapshot();
    expect(result.code).toBe(kind === "cancel" ? "cancelled" : "deadline_exceeded");
    expect(snapshot.pendingAttempts).toBe(1);
    response.resolve({ output: "late", providerAttempts: 1, usage: { inputTokens: 4, totalTokens: 4 } });
    await flush();
    expect(f.run.snapshot().pendingAttempts).toBe(0);
    expect(f.run.snapshot().usage.totals.inputTokens.total).toBe(4);
    expect(f.run.snapshot().usage.stages[0]?.outcome).toBe("discarded");
    expect(JSON.stringify(result)).toBe(before);
    expect(snapshot.pendingAttempts).toBe(1);
  });

  it("keeps known consumption after malformed attempt counts and accounting failure", async () => {
    const f = setup();
    const malformed = await f.run.attempt({ ...f.input, invoke: async () => ({ output: "x", providerAttempts: 0, usage: { inputTokens: 7 } }) });
    expect(malformed.code).toBe("provider_unavailable");
    expect(f.run.snapshot().usage.totals.providerAttempts).toBe(1);
    expect(f.run.snapshot().usage.totals.inputTokens.knownSubtotal).toBe(7);
    const ledger = { reserve: vi.fn(f.budget.ledger.reserve), settle: vi.fn().mockRejectedValue(new Error("secret payload")) };
    const run = createAicfProviderRun({ runId: "run_example", deadlineAt: Date.now() + 1000, budget: { ledger, policy: f.budget.policy } });
    expect((await run.attempt(f.input)).code).toBe("accounting_unavailable");
    expect((await run.attempt(f.input)).code).toBe("accounting_unavailable");
    expect(ledger.reserve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(run.snapshot())).not.toContain("secret payload");
  });

  it("does not spend after reservation revocation, pre-call cancellation or expired bounds", async () => {
    const f = setup(), invoke = vi.fn(f.input.invoke); let revoked = false;
    const ledger = { reserve: async (input: any) => { const result = await f.budget.ledger.reserve(input); revoked = true; return result; }, settle: vi.fn(f.budget.ledger.settle) };
    const run = createAicfProviderRun({ runId: "run_example", deadlineAt: Date.now() + 1000, budget: { ledger, policy: f.budget.policy } });
    expect((await run.attempt({ ...f.input, invoke, guard: () => revoked ? "stale_binding" : undefined })).code).toBe("stale_binding");
    expect(invoke).not.toHaveBeenCalled(); expect(ledger.settle).toHaveBeenCalledTimes(1);
    expect((await f.run.attempt({ ...f.input, invoke, deadlineAt: 1 })).code).toBe("deadline_exceeded");
    const controller = new AbortController(); controller.abort();
    expect((await f.run.attempt({ ...f.input, invoke, signal: controller.signal })).code).toBe("cancelled");
  });

  it("rejects conflicting run IDs and budgets without a call", async () => {
    const f = setup(), h = await createDiscoveryExample();
    await expect(f.run.attempt({ ...f.input, runId: "another" })).rejects.toThrow("mismatch");
    const api = createCapabilityDiscovery({ registry: h.registry });
    await expect(api.search({ tasks: [{ id: "one", text: "ticket" }], runtimeContext: h.runtimeContext, providerRun: f.run,
      budget: setup().budget })).rejects.toThrow("conflict");
  });

  it("rejects provider configuration containing undeclared credential fields before retaining receipts", async () => {
    const f = setup(), invoke = vi.fn(f.input.invoke);
    await expect(f.run.attempt({ ...f.input, invoke, configuration: { ...configuration, apiKey: "synthetic-secret" } as any })).rejects.toThrow("valid invocation");
    expect(invoke).not.toHaveBeenCalled(); expect(f.run.snapshot().usage.stages).toEqual([]);
  });

  it("keeps only bounded metadata, preserves numeric receipts through redaction, and tolerates failed sinks", async () => {
    const f = setup();
    const run = createAicfProviderRun({ runId: "run_example", deadlineAt: Date.now() + 1000, budget: f.budget,
      traceSink: { emit() { throw new Error("private body"); } } });
    const result = await run.attempt(f.input);
    expect(result.value).toBe("planned");
    run.record("selection.end", "request", { taskCount: 1, rawPrompt: "private request" } as any);
    const event = createTraceEvent({ type: "provider.attempt.end", runId: "run", requestId: "request", contentCapture: "redacted_content",
      attributes: { inputTokens: { total: 7, knownSubtotal: 7, complete: true }, rawPrompt: "private request", cards: ["secret"], fingerprint: "sha256:" + "a".repeat(64) } });
    expect(event.attributes.inputTokens).toEqual({ total: 7, knownSubtotal: 7, complete: true });
    expect(JSON.stringify(event)).not.toContain("private request");
    for (let i = 0; i < 300; i++) run.record("discovery.end", "request", { candidateCount: 1 });
    expect(run.snapshot().events).toHaveLength(256);
    expect(run.snapshot().diagnostics.map(item => item.code)).toContain("trace_overflow");
    expect(run.snapshot().diagnostics.map(item => item.code)).toContain("trace_sink_failed");
    expect(JSON.stringify(run.snapshot())).not.toContain("private body");
  });
});
