import { describe, expect, it, vi } from "vitest";
import { createCapabilityDiscovery, createInMemoryDiscoveryBudget } from "../../discovery/index.js";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import { MockSelectionClient, selectionResponse, selectedDecision } from "../../../examples/12-capability-discovery-selection/mock-selection.mjs";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const output = () => selectionResponse(selectedDecision("one", "support.ticket.get"));

async function fixture(outputs: unknown[] = [output()], controls?: any) {
  const h = await createDiscoveryExample();
  const api = createCapabilityDiscovery({ registry: h.registry });
  const results = await api.search({ tasks: [{ id: "one", text: "ticket" }], runtimeContext: h.runtimeContext, controls });
  const scope = createInMemoryDiscoveryBudget({ runId: h.runtimeContext.runId, maxProviderCalls: 4, maxInputTokens: 16_000 });
  const ledger = { reserve: vi.fn(scope.ledger.reserve), settle: vi.fn(scope.ledger.settle) };
  const client = new MockSelectionClient(outputs);
  const options = { results, client, budget: { ledger, policy: scope.policy }, maxInputTokens: 4000, maxOutputTokens: 1000 };
  return { h, api, client, ledger, scope, options };
}

describe("selection reservation, settlement and cancellation", () => {
  it("reserves complete call/input/output allowances and settles successful work once", async () => {
    const f = await fixture();
    const batch = await f.api.select(f.options);
    expect(batch.outcomes[0]?.status).toBe("selected");
    expect(f.ledger.reserve).toHaveBeenCalledTimes(1);
    expect(f.ledger.reserve.mock.calls[0]?.[0]).toMatchObject({ stage: "selection", attempt: 1,
      requestedUsage: { providerCalls: 1, inputTokens: 4000, outputTokens: 1000, retries: 0 } });
    expect(f.ledger.settle).toHaveBeenCalledTimes(1);
    expect(f.ledger.settle.mock.calls[0]?.[1]).toMatchObject({ outcome: "completed", providerAttempts: 1, completedResponses: 1 });
    expect(batch.usage.stages[0]?.mock).toBe(true);
  });

  it.each(["denied", "reserve-error", "settle-error", "provider-error"])("fails safely after %s without repair", async kind => {
    const f = await fixture();
    if (kind === "denied") f.ledger.reserve.mockResolvedValue({ status: "denied", diagnostic: { code: "budget_denied", message: "private provider body" } });
    if (kind === "reserve-error") f.ledger.reserve.mockRejectedValue(new Error("private provider body"));
    if (kind === "settle-error") f.ledger.settle.mockRejectedValue(new Error("private provider body"));
    if (kind === "provider-error") f.client.generateStructured = vi.fn().mockRejectedValue(Object.assign(new Error("private provider body"), {
      providerAttempts: 1, usage: { inputTokens: 17, totalTokens: 20 }
    }));
    const batch = await f.api.select({ ...f.options, limits: { maxAttempts: 2 } });
    expect(batch.outcomes[0]?.status).toBe("unavailable");
    expect(batch.usage.totals.providerAttempts).toBe(kind === "settle-error" || kind === "provider-error" ? 1 : 0);
    expect(JSON.stringify(batch)).not.toContain("private provider body");
    expect(f.ledger.reserve).toHaveBeenCalledTimes(1);
    if (kind === "provider-error") expect(batch.usage.totals).toMatchObject({ inputTokens: { total: 17 },
      outputTokens: { total: null, knownSubtotal: 0, complete: false }, estimatedCost: { total: null, complete: false } });
  });

  it.each(["permission", "source", "identity", "control", "model", "provenance", "cancel"])("rechecks %s after reservation and releases unused allowance", async kind => {
    let providerDenied = false;
    const controls = { evaluate: ({ operation }: any) => ({ status: providerDenied && operation === "provider_call" ? "denied" : "allowed",
      reasons: [], warnings: [], matchedKillSwitches: [], matchedCircuitBreakers: [] }) };
    const f = await fixture([output()], controls);
    const controller = new AbortController();
    f.ledger.reserve.mockImplementation(async input => {
      const reservation = await f.scope.ledger.reserve(input);
      if (kind === "permission") f.h.runtimeContext.subject.permissions = [];
      if (kind === "source") f.h.registry.capabilities[0].manifest.summary += " changed";
      if (kind === "identity") f.h.runtimeContext.account.accountId = "another_account";
      if (kind === "control") providerDenied = true;
      if (kind === "model") f.client.configuration.model += " changed";
      if (kind === "provenance") f.client.mock = false;
      if (kind === "cancel") controller.abort();
      return reservation;
    });
    const batch = await f.api.select({ ...f.options, signal: controller.signal, limits: { maxAttempts: 2 } });
    expect(batch.outcomes[0]?.status).toBe(kind === "cancel" ? "cancelled" : "unavailable");
    expect(f.client.calls).toHaveLength(0);
    expect(f.ledger.settle).toHaveBeenCalledTimes(1);
    expect(f.ledger.settle.mock.calls[0]?.[1]).toMatchObject({ providerAttempts: 0, completedResponses: 0 });
    expect(batch.usage.totals.providerAttempts).toBe(0);
  });

  it.each(["permissions", "source", "model", "provenance", "control", "settlement"])("discards completed output after %s changes", async kind => {
    let denied = false;
    const controls = { evaluate: ({ operation }: any) => ({ status: denied && operation === "provider_call" ? "denied" : "allowed",
      reasons: [], warnings: [], matchedKillSwitches: [], matchedCircuitBreakers: [] }) };
    const f = await fixture([output()], controls);
    const generate = f.client.generateStructured.bind(f.client);
    f.client.generateStructured = async input => {
      const response = await generate(input);
      if (kind === "permissions") f.h.runtimeContext.subject.permissions = [];
      if (kind === "source") f.h.registry.capabilities[0].manifest.model_description += " changed";
      if (kind === "model") f.client.configuration.model += " changed";
      if (kind === "provenance") f.client.mock = false;
      if (kind === "control") denied = true;
      return response;
    };
    if (kind === "settlement") f.ledger.settle.mockImplementation(async (id, result) => {
      await f.scope.ledger.settle(id, result);
      f.h.runtimeContext.facts.changed = true;
    });
    const batch = await f.api.select({ ...f.options, limits: { maxAttempts: 2 } });
    expect(batch.outcomes[0]?.status).toBe("unavailable");
    expect(batch.usage.totals).toMatchObject({ providerAttempts: 1, completedResponses: 1, totalTokens: { total: 140 } });
    expect(f.client.calls).toHaveLength(1);
    expect(f.ledger.settle).toHaveBeenCalledTimes(1);
  });

  it("retains unknown usage and holds a pending reservation until its late settlement", async () => {
    const f = await fixture();
    const started = deferred<void>(), response = deferred<any>();
    f.client.generateStructured = vi.fn(async () => { started.resolve(); return response.promise; });
    const controller = new AbortController();
    const pending = f.api.select({ ...f.options, signal: controller.signal, limits: { maxAttempts: 2 } });
    await started.promise;
    controller.abort();
    const batch = await pending;
    const snapshot = JSON.stringify(batch);
    expect(batch.outcomes[0]?.status).toBe("cancelled");
    expect(batch.usage.stages[0]?.pending).toBe(true);
    expect(batch.usage.totals.totalTokens).toEqual({ total: null, knownSubtotal: 0, complete: false });
    expect(f.ledger.settle).not.toHaveBeenCalled();
    response.resolve({ output: output(), providerAttempts: 1, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
    await flush();
    expect(f.ledger.settle).toHaveBeenCalledTimes(1);
    expect(f.ledger.settle.mock.calls[0]?.[1]).toMatchObject({ outcome: "discarded", usage: { totalTokens: 12 } });
    expect(JSON.stringify(batch)).toBe(snapshot);
  });

  it("releases an unused reservation that arrives after cancellation", async () => {
    const f = await fixture();
    const started = deferred<void>(), reservation = deferred<any>();
    f.ledger.reserve.mockImplementation(async () => { started.resolve(); return reservation.promise; });
    f.ledger.settle.mockResolvedValue();
    const controller = new AbortController();
    const pending = f.api.select({ ...f.options, signal: controller.signal });
    await started.promise; controller.abort();
    expect((await pending).outcomes[0]?.status).toBe("cancelled");
    reservation.resolve({ status: "reserved", reservationId: "late_reservation" });
    await flush();
    expect(f.client.calls).toHaveLength(0);
    expect(f.ledger.settle).toHaveBeenCalledTimes(1);
    expect(f.ledger.settle.mock.calls[0]?.[1]).toMatchObject({ providerAttempts: 0 });
  });

  it("expires during an unresolved provider call and retains the reservation", async () => {
    const f = await fixture();
    const started = deferred<void>(), response = deferred<any>();
    f.client.generateStructured = vi.fn(async () => { started.resolve(); return response.promise; });
    const pending = f.api.select({ ...f.options, deadlineAt: Date.now() + 200 });
    await started.promise;
    const batch = await pending;
    expect(batch.outcomes[0]).toMatchObject({ status: "cancelled", reasonCode: "deadline_exceeded" });
    expect(f.ledger.settle).not.toHaveBeenCalled();
    response.resolve({ output: output(), providerAttempts: 1 });
    await flush();
    expect(f.ledger.settle).toHaveBeenCalledTimes(1);
  });

  it("uses unknown fields conservatively and optionally estimates cost without double-counting token categories", async () => {
    const f = await fixture();
    f.client.generateStructured = async () => ({ output: output(), providerAttempts: 1,
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 4, reasoningTokens: 1 } });
    const batch = await f.api.select({ ...f.options, estimateCost: () => 0.25 });
    expect(batch.usage.totals).toMatchObject({ totalTokens: { total: 12 }, cachedInputTokens: { total: 4 },
      reasoningTokens: { total: 1 }, estimatedCost: { total: 0.25, complete: true } });
    expect(f.ledger.settle.mock.calls[0]?.[1].usage.estimatedCost).toBe(0.25);
    const unknown = await f.api.select({ ...f.options, client: { ...f.client, generateStructured: async () => ({ output: output(), providerAttempts: 1 }) } });
    expect(unknown.outcomes[0]?.status).toBe("selected");
    expect(unknown.usage.totals.inputTokens.complete).toBe(false);
  });

  it.each([0, 2])("rejects unexpected attempt count %s without repair and preserves observed work", async reported => {
    const f = await fixture();
    const generate = f.client.generateStructured.bind(f.client);
    f.client.generateStructured = async input => ({ ...await generate(input), providerAttempts: reported });
    const batch = await f.api.select({ ...f.options, limits: { maxAttempts: 2 } });
    expect(batch.outcomes[0]).toMatchObject({ status: "unavailable", reasonCode: "provider_unavailable" });
    expect(batch.usage.totals.providerAttempts).toBe(Math.max(1, reported));
    expect(batch.usage.totals.totalTokens.total).toBe(140);
    expect(f.client.calls).toHaveLength(1);
  });

  it("retains initial consumption when repair is denied or fails, without another repair", async () => {
    const f = await fixture([{}]);
    const budget = createInMemoryDiscoveryBudget({ runId: f.h.runtimeContext.runId, maxProviderCalls: 1, maxInputTokens: 8000 });
    const denied = await f.api.select({ ...f.options, budget, limits: { maxAttempts: 2 } });
    expect(denied.outcomes[0]).toMatchObject({ status: "unavailable", reasonCode: "budget_denied" });
    expect(denied.usage.totals.providerAttempts).toBe(1);
    const error = Object.assign(new Error("private provider error"), { providerAttempts: 1,
      usage: { inputTokens: 10, totalTokens: 12, cachedInputTokens: 3, reasoningTokens: 1 } });
    const client = new MockSelectionClient([{}, error]);
    const failed = await f.api.select({ ...f.options, client, limits: { maxAttempts: 2 } });
    expect(failed.usage.totals).toMatchObject({ providerAttempts: 2, repairAttempts: 1, totalTokens: { total: 152, complete: true },
      inputTokens: { total: 130 }, outputTokens: { total: null, knownSubtotal: 20, complete: false } });
    expect(client.calls).toHaveLength(2);
  });

  it("requires cost ceilings for cost-capped policies and passes them to reservations", async () => {
    const f = await fixture();
    const budget = createInMemoryDiscoveryBudget({ runId: f.h.runtimeContext.runId, maxProviderCalls: 2, maxInputTokens: 8000, maxEstimatedCost: 1 });
    await expect(f.api.select({ ...f.options, budget })).rejects.toMatchObject({ code: "invalid_configuration" });
    expect(f.client.calls).toHaveLength(0);
    expect((await f.api.select({ ...f.options, budget, maxEstimatedCostPerCall: 0.5 })).outcomes[0]?.status).toBe("selected");
  });

  it("does not repair malformed protocol envelopes, malformed usage, missing provenance or cost-estimator failures", async () => {
    for (const kind of ["envelope", "usage", "provenance", "estimator"]) {
      const f = await fixture();
      if (kind === "provenance") {
        delete (f.client as any).mock;
        await expect(f.api.select(f.options)).rejects.toMatchObject({ code: "invalid_configuration" });
      } else {
        const generate = f.client.generateStructured.bind(f.client);
        f.client.generateStructured = async input => {
          const response = await generate(input);
          if (kind === "envelope") delete response.output;
          if (kind === "usage") response.usage.inputTokens = NaN;
          if (kind === "estimator") delete response.usage.estimatedCost;
          return response;
        };
        const batch = await f.api.select({ ...f.options, limits: { maxAttempts: 2 },
          ...(kind === "estimator" ? { estimateCost: () => { throw new Error("private pricing data"); } } : {}) });
        expect(batch.outcomes[0]?.status).toBe("unavailable");
        expect(f.client.calls).toHaveLength(1);
        expect(JSON.stringify(batch)).not.toContain("private pricing data");
      }
    }
  });
});
