import { describe, expect, it, vi } from "vitest";
import { runEmbeddingAttempt, type EmbeddingAttemptRequest } from "../../discovery/embeddings.js";
import { aggregateDiscoveryUsage } from "../../discovery/usage.js";
import { resolveEmbeddingExecution, resolveIndexLimits } from "../../discovery/embedding-configuration.js";
import {
  DeterministicMockEmbeddingClient, MockDiscoveryBudget, embeddingExecution
} from "../../../examples/12-capability-discovery-selection/mock-embeddings.mjs";

function fixture() {
  const client = new DeterministicMockEmbeddingClient();
  const budget = new MockDiscoveryBudget();
  const request: EmbeddingAttemptRequest = {
    client, budget, configuration: { ...client.configuration }, mock: true, texts: ["ticket"],
    stage: "query_embedding", execution: structuredClone(embeddingExecution), maxVectorDimension: 16, expectedDimension: 2,
    runId: "run_example", requestId: "request_example", deadlineAt: Date.now() + 10_000
  };
  return { client, budget, request };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe("bounded embedding attempts and usage accounting", () => {
  it.each([0, -1, 1.5, NaN, Infinity, "100", Number.MAX_SAFE_INTEGER + 1])("requires explicit finite positive artifact limits %s", value => {
    expect(() => resolveIndexLimits({ maxArtifactBytes: value as number, maxEntries: 1, maxVectorDimension: 2 })).toThrow();
  });

  it("validates cost reservations, token ceilings and all existing autonomy scope values", () => {
    const { request } = fixture();
    for (const key of ["maxInputTokens", "maxCharactersPerText", "maxCharactersPerCall"] as const) {
      expect(() => resolveEmbeddingExecution({ ...request.execution, limits: { ...request.execution.limits, [key]: 0 } })).toThrow();
    }
    const missingCost = structuredClone(request.execution);
    delete missingCost.limits.maxEstimatedCostPerCall;
    expect(() => resolveEmbeddingExecution(missingCost)).toThrow();
    for (const autonomyTier of ["A0", "A1", "A2", "A3", "A4", "A5"] as const) {
      expect(resolveEmbeddingExecution({ ...request.execution, budgetPolicy: {
        ...request.execution.budgetPolicy, scope: { type: "autonomy_tier", autonomyTier }
      } }).budgetPolicy.scope).toEqual({ type: "autonomy_tier", autonomyTier });
    }
  });

  it("reserves before one attempt and settles once, passing provider bounds and identity", async () => {
    const { request, client, budget } = fixture();
    const result = await runEmbeddingAttempt(request);
    expect(result.status).toBe("completed");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({ attempt: 1, maxInputTokens: 4000, deadlineAt: request.deadlineAt });
    expect(client.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(budget.reservations[0].requestedUsage).toEqual({ providerCalls: 1, inputTokens: 4000, retries: 0, estimatedCost: 1 });
    expect(budget.settlements).toHaveLength(1);
    expect(budget.settlements[0].result).toMatchObject({ outcome: "completed", providerAttempts: 1, completedResponses: 1 });
    expect(Object.isFrozen(result.usage.stages[0]?.inputTokens)).toBe(true);
  });

  it.each(["cancel", "deadline", "control", "budget", "revoked"])("prevents provider work on %s", async kind => {
    const { request, client, budget } = fixture();
    if (kind === "cancel") { const controller = new AbortController(); controller.abort(); request.signal = controller.signal; }
    if (kind === "deadline") request.deadlineAt = Date.now() - 1;
    if (kind === "control") request.controls = { evaluate: () => ({ status: "denied", matchedCircuitBreakers: [], matchedKillSwitches: [], reasons: [], warnings: [] }) };
    if (kind === "budget") budget.reserve = async () => ({ status: "denied", diagnostic: { code: "budget_denied", message: "private host reason" } });
    if (kind === "revoked") request.isCurrent = () => false;
    const result = await runEmbeddingAttempt(request);
    expect(result.status).not.toBe("completed");
    expect(client.calls).toEqual([]);
    expect(result.usage.totals.providerAttempts).toBe(0);
    expect(result.usage.totals.totalTokens).toEqual({ total: 0, knownSubtotal: 0, complete: true });
    expect(JSON.stringify(result)).not.toContain("private host reason");
  });

  it("rechecks revocation after reservation and settles the unused reservation", async () => {
    const { request, client, budget } = fixture();
    let current = true;
    request.isCurrent = () => current;
    const reserve = budget.reserve.bind(budget);
    budget.reserve = async input => { const result = await reserve(input); current = false; return result; };
    const result = await runEmbeddingAttempt(request);
    expect(result).toMatchObject({ status: "unavailable", diagnostics: [{ code: "stale_binding" }] });
    expect(client.calls).toEqual([]);
    expect(budget.settlements).toHaveLength(1);
    expect(budget.settlements[0].result.providerAttempts).toBe(0);
  });

  it.each(["reservation", "settlement"])("bounds %s exceptions without retries or fallback", async kind => {
    const { request, client, budget } = fixture();
    if (kind === "reservation") budget.reserve = async () => { throw new Error("private reservation error"); };
    else budget.settle = async () => { throw new Error("private settlement error"); };
    const result = await runEmbeddingAttempt(request);
    expect(result).toMatchObject({ status: "unavailable", diagnostics: [{ code: "accounting_unavailable" }] });
    expect(client.calls).toHaveLength(kind === "reservation" ? 0 : 1);
    expect(result.usage.totals.completedResponses).toBe(kind === "reservation" ? 0 : 1);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("preserves unknown quantities and aggregates known subtotals without double-counting token categories", async () => {
    const { request, client } = fixture();
    const original = client.embed.bind(client);
    client.embed = async input => ({ ...await original(input), usage: { inputTokens: 5, totalTokens: 5, cachedInputTokens: 2, reasoningTokens: 1 } });
    const first = await runEmbeddingAttempt(request);
    expect(first.usage.totals.totalTokens.total).toBe(5);
    expect(first.usage.totals.outputTokens).toEqual({ total: null, knownSubtotal: 0, complete: false });
    expect(first.usage.totals.estimatedCost.total).toBeNull();
    client.embed = async input => ({ ...await original(input), usage: { totalTokens: 3 } });
    const second = await runEmbeddingAttempt(request);
    const aggregate = aggregateDiscoveryUsage([...first.usage.stages, ...second.usage.stages], 10);
    expect(aggregate.totals.providerAttempts).toBe(2);
    expect(aggregate.totals.totalTokens.total).toBe(8);
    expect(aggregate.totals.inputTokens).toEqual({ total: null, knownSubtotal: 5, complete: false });
  });

  it("prices only through an optional caller function and retains known usage from failures", async () => {
    const { request, client, budget } = fixture();
    client.embed = async () => { throw Object.assign(new Error("private body"), { usage: { inputTokens: 9 }, providerAttempts: 1 }); };
    request.execution.estimateCost = usage => usage.inputTokens === undefined ? undefined : usage.inputTokens * 0.01;
    const result = await runEmbeddingAttempt(request);
    expect(result).toMatchObject({ status: "unavailable", diagnostics: [{ code: "provider_unavailable" }] });
    expect(result.usage.totals.estimatedCost.total).toBe(0.09);
    expect(result.usage.totals.inputTokens.total).toBe(9);
    expect(budget.settlements[0].result.usage.inputTokens).toBe(9);
    expect(JSON.stringify(result)).not.toContain("private body");
  });

  it.each([
    ["attempts", response => { response.providerAttempts = 2; }],
    ["model", response => { response.configuration.model = "other"; }],
    ["dimension", response => { response.vectorDimension = 3; }],
    ["count", response => { response.vectors.push([1, 0]); }],
    ["zero", response => { response.vectors = [[0, 0]]; }],
    ["sparse", response => { response.vectors = [new Array(2)]; }],
    ["nonfinite", response => { response.vectors = [[NaN, 1]]; }],
    ["usage", response => { response.usage = { inputTokens: 7, totalTokens: -1 }; }],
    ["configuration", response => { response.configuration = { model: "other" }; }]
  ] as [string, (response: any) => void][])("rejects malformed %s while retaining completed response and known usage", async (_, change) => {
    const { request, client, budget } = fixture();
    const original = client.embed.bind(client);
    client.embed = async input => { const result = await original(input); change(result); return result; };
    const result = await runEmbeddingAttempt(request);
    expect(result.status).toBe("unavailable");
    expect(result.usage.totals.completedResponses).toBe(1);
    expect(result.usage.totals.inputTokens.complete).toBe(true);
    expect(budget.settlements[0].result.outcome).toBe("discarded");
    expect(budget.settlements[0].result.providerAttempts).toBe(_ === "attempts" ? 2 : 1);
    expect(result.usage.totals.retryAttempts).toBe(_ === "attempts" ? 1 : 0);
  });

  it("returns promptly on cancellation, retaining the pending reservation until a late response settles", async () => {
    const { request, client, budget } = fixture();
    const controller = new AbortController(); request.signal = controller.signal;
    const started = deferred<void>(), reply = deferred<any>();
    const original = client.embed.bind(client);
    let response: any;
    client.embed = async input => { response = await original(input); started.resolve(); return reply.promise; };
    const task = runEmbeddingAttempt(request);
    await started.promise;
    controller.abort();
    const result = await task;
    expect(result).toMatchObject({ status: "cancelled", usage: { stages: [{ pending: true }] } });
    expect(result.usage.totals.providerAttempts).toBe(1);
    expect(result.usage.totals.inputTokens.complete).toBe(false);
    expect(budget.outstanding.size).toBe(1);
    expect(budget.settlements).toEqual([]);
    const snapshot = JSON.stringify(result);
    reply.resolve(response); await flush();
    expect(budget.outstanding.size).toBe(0);
    expect(budget.settlements).toHaveLength(1);
    expect(budget.settlements[0].result).toMatchObject({ outcome: "discarded", completedResponses: 1 });
    expect(JSON.stringify(result)).toBe(snapshot);
  });

  it("expires an uncooperative pending call and observes its late rejection", async () => {
    vi.useFakeTimers();
    try {
      const { request, client, budget } = fixture();
      request.deadlineAt = Date.now() + 100;
      const started = deferred<void>(), reply = deferred<any>();
      client.embed = async () => { started.resolve(); return reply.promise; };
      const task = runEmbeddingAttempt(request);
      await started.promise;
      await vi.advanceTimersByTimeAsync(101);
      const result = await task;
      expect(result).toMatchObject({ status: "cancelled", diagnostics: [{ code: "deadline_exceeded" }] });
      expect(budget.outstanding.size).toBe(1);
      reply.reject(Object.assign(new Error("private late response"), { usage: { inputTokens: 8 }, providerAttempts: 1 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(budget.settlements).toHaveLength(1);
      expect(budget.settlements[0].result.usage.inputTokens).toBe(8);
    } finally { vi.useRealTimers(); }
  });

  it("settles a reservation that completes after cancellation without starting a provider call", async () => {
    const { request, client, budget } = fixture();
    const controller = new AbortController(); request.signal = controller.signal;
    const started = deferred<void>(), reserved = deferred<any>();
    const original = budget.reserve.bind(budget);
    budget.reserve = async input => { started.resolve(); await reserved.promise; return original(input); };
    const task = runEmbeddingAttempt(request);
    await started.promise; controller.abort();
    const result = await task;
    expect(result.status).toBe("cancelled"); expect(client.calls).toEqual([]);
    reserved.resolve(undefined); await flush();
    expect(budget.settlements).toHaveLength(1);
    expect(budget.settlements[0].result.providerAttempts).toBe(0);
  });

  it("rejects vector-batch accessors without invoking them or losing completed-response usage", async () => {
    const { request, client, budget } = fixture();
    let accessed = false;
    const original = client.embed.bind(client);
    client.embed = async input => {
      const response = await original(input);
      response.vectors = Object.defineProperty(new Array(1), "0", {
        enumerable: true, get() { accessed = true; return [1, 0]; }
      });
      return response;
    };
    const result = await runEmbeddingAttempt(request);
    expect(result).toMatchObject({ status: "unavailable", diagnostics: [{ code: "invalid_embedding" }] });
    expect(accessed).toBe(false);
    expect(result.usage.totals.completedResponses).toBe(1);
    expect(budget.settlements).toHaveLength(1);
  });

  it("retains known usage and settles only once when cancellation happens during settlement", async () => {
    const { request, budget } = fixture();
    const controller = new AbortController(); request.signal = controller.signal;
    const started = deferred<void>(), done = deferred<void>();
    const original = budget.settle.bind(budget);
    const settle = vi.fn(async (id, result) => { started.resolve(); await done.promise; return original(id, result); });
    budget.settle = settle;
    const task = runEmbeddingAttempt(request);
    await started.promise; controller.abort();
    const result = await task;
    expect(result.status).toBe("cancelled");
    expect(result.usage.totals.completedResponses).toBe(1);
    expect(result.usage.totals.inputTokens.complete).toBe(true);
    expect(result.usage.stages[0]?.pending).toBe(true);
    expect(budget.outstanding.size).toBe(1);
    done.resolve(); await flush();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(budget.outstanding.size).toBe(0);
  });
});
