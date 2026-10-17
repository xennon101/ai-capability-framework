import { describe, expect, it } from "vitest";
import { createInMemoryDiscoveryBudget } from "../../discovery/budget.js";
import type { ProviderAttemptReservation, ProviderAttemptSettlement } from "../../discovery/types.js";
import { runEmbeddingAttempt } from "../../discovery/embeddings.js";
import { DeterministicMockEmbeddingClient } from "../../../examples/12-capability-discovery-selection/mock-embeddings.mjs";

function fixture(maxProviderCalls = 2, maxInputTokens = 200, maxEstimatedCost?: number) {
  const scope = createInMemoryDiscoveryBudget({ runId: "run", maxProviderCalls, maxInputTokens, maxEstimatedCost });
  const input: ProviderAttemptReservation = { runId: "run", requestId: "request", deadlineAt: Date.now() + 10_000,
    stage: "query_embedding", attempt: 1, configuration: { provider: "mock", model: "mock", configurationId: "mock.v1" },
    policy: scope.policy, requestedUsage: { providerCalls: 1, inputTokens: 100, ...(maxEstimatedCost === undefined ? {} : { estimatedCost: 1 }) } };
  return { ...scope, input };
}
const settled: ProviderAttemptSettlement = { outcome: "completed", providerAttempts: 1, completedResponses: 1,
  usage: { inputTokens: 10, estimatedCost: 0.1 }, elapsedMs: 1 };

describe("optional single-process run budget", () => {
  it("reserves atomically across concurrent requests and releases unused reservations once", async () => {
    const { ledger, input } = fixture(1);
    const [first, second] = await Promise.all([ledger.reserve(input), ledger.reserve(input)]);
    expect(first.status).toBe("reserved"); expect(second.status).toBe("denied");
    if (first.status !== "reserved") throw new Error("Fixture must reserve.");
    await ledger.settle(first.reservationId, { ...settled, outcome: "cancelled", providerAttempts: 0, completedResponses: 0, usage: {} });
    expect((await ledger.reserve(input)).status).toBe("reserved");
    await expect(ledger.settle(first.reservationId, settled)).rejects.toMatchObject({ code: "accounting_unavailable" });
  });

  it.each(["completed", "failed", "cancelled", "discarded"] as const)("retains known consumption after %s", async outcome => {
    const { ledger, input } = fixture(5, 100, 1);
    const reservation = await ledger.reserve(input);
    if (reservation.status !== "reserved") throw new Error("Fixture must reserve.");
    await ledger.settle(reservation.reservationId, { ...settled, outcome });
    expect((await ledger.reserve({ ...input, requestedUsage: { providerCalls: 1, inputTokens: 90, estimatedCost: 0.9 } })).status).toBe("reserved");
    expect((await ledger.reserve({ ...input, requestedUsage: { providerCalls: 1, inputTokens: 1, estimatedCost: 0 } })).status).toBe("denied");
  });

  it("holds full allowance for pending and unreported consumption", async () => {
    const { ledger, input } = fixture(5, 100, 1);
    const reservation = await ledger.reserve(input);
    if (reservation.status !== "reserved") throw new Error("Fixture must reserve.");
    expect((await ledger.reserve(input)).status).toBe("denied");
    const usage = Object.freeze({});
    await ledger.settle(reservation.reservationId, { ...settled, usage });
    expect(usage).toEqual({});
    expect((await ledger.reserve(input)).status).toBe("denied");
  });

  it("accounts excess reported attempts and completed responses even with malformed zero attempt counts", async () => {
    for (const report of [{ providerAttempts: 3, completedResponses: 1 }, { providerAttempts: 0, completedResponses: 2 }]) {
      const { ledger, input } = fixture(2, 1000);
      const reservation = await ledger.reserve(input);
      if (reservation.status !== "reserved") throw new Error("Fixture must reserve.");
      await ledger.settle(reservation.reservationId, { ...settled, ...report });
      expect((await ledger.reserve(input)).status).toBe("denied");
    }
  });

  it("enforces run boundaries, expiry, cancellation and cost ceilings", async () => {
    const { ledger, input } = fixture(10, 1000, 1);
    const controller = new AbortController(); controller.abort();
    for (const patch of [{ runId: "other" }, { deadlineAt: Date.now() - 1 }, { signal: controller.signal },
      { requestedUsage: { providerCalls: 1, inputTokens: 100 } }, { requestedUsage: { providerCalls: 1, inputTokens: 100, estimatedCost: 2 } }]) {
      expect((await ledger.reserve({ ...input, ...patch })).status).toBe("denied");
    }
    expect((await ledger.reserve(input)).status).toBe("reserved");
  });

  it("retains an in-flight reservation until late completion without changing cancelled usage", async () => {
    const { ledger, policy, input } = fixture(2, 100);
    const client = new DeterministicMockEmbeddingClient();
    const original = client.embed.bind(client);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    client.embed = async request => { entered(); await waiting; return original(request); };
    const controller = new AbortController();
    const pending = runEmbeddingAttempt({ ...input, configuration: client.configuration, client, mock: true, texts: ["ticket"], budget: ledger,
      signal: controller.signal, stage: "query_embedding", maxVectorDimension: 2,
      execution: { budgetPolicy: policy, limits: { maxInputTokens: 100, maxCharactersPerText: 100, maxCharactersPerCall: 100 } } });
    await started;
    controller.abort();
    const cancelled = await pending;
    const snapshot = JSON.stringify(cancelled);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.usage.totals.totalTokens.complete).toBe(false);
    expect((await ledger.reserve(input)).status).toBe("denied");
    release();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect((await ledger.reserve({ ...input, requestedUsage: { providerCalls: 1, inputTokens: 98 } })).status).toBe("reserved");
    expect(JSON.stringify(cancelled)).toBe(snapshot);
  });

  it.each([0, -1, NaN, Infinity, 1.5, "10", Number.MAX_SAFE_INTEGER + 1])("rejects invalid finite caps %s", value => {
    for (const key of ["maxProviderCalls", "maxInputTokens"] as const) expect(() => createInMemoryDiscoveryBudget({
      runId: "run", maxProviderCalls: 1, maxInputTokens: 100, [key]: value
    } as never)).toThrow();
  });
});
