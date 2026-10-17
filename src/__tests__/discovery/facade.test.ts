import { describe, expect, it, vi } from "vitest";
import {
  CapabilityDiscoverer, createCapabilityDiscovery, createInMemoryDiscoveryBudget, DISCOVERY_STANDARD_PROFILE,
  buildCapabilityEmbeddingIndex, buildCapabilitySearchCorpus
} from "../../discovery/index.js";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import { DeterministicMockEmbeddingClient, embeddingIndexLimits } from "../../../examples/12-capability-discovery-selection/mock-embeddings.mjs";

async function fixture() {
  const h = await createDiscoveryExample();
  const api = createCapabilityDiscovery({ registry: h.registry });
  const input = { tasks: [{ id: "read", text: h.userInput.text }], runtimeContext: h.runtimeContext };
  const route = { registry: h.registry, builtContext: h.builtContext, userInput: h.userInput };
  return { h, api, input, route };
}

describe("application-driven discovery facade", () => {
  it("needs only a registry, tasks and existing context, and matches the explicit engine", async () => {
    const { h, api, input, route } = await fixture();
    input.tasks.push({ id: "read-again", text: h.userInput.text });
    const results = await api.search(input);
    const explicit = await new CapabilityDiscoverer({ mode: "lexical", policyVersion: DISCOVERY_STANDARD_PROFILE.policyVersion }).discover({
      routeRequest: route, runId: h.runtimeContext.runId, requestId: h.runtimeContext.requestId,
      queries: input.tasks.map(task => ({ id: task.id, fragments: [{ key: "task", text: task.text }] }))
    });
    const withoutTime = (entries: typeof results) => entries.map(({ usage, ...entry }) => entry);
    expect(withoutTime(results)).toEqual(withoutTime(explicit));
    expect(results.map(result => result.queryId)).toEqual(["read", "read-again"]);
    expect(results[0]?.candidates).toEqual(results[1]?.candidates);
    expect(results[0]?.usage.totals.providerAttempts).toBe(0);
    expect(Object.isFrozen(results[0]?.candidates[0]?.scores)).toBe(true);
    expect(api.routerFor(results[0]!).route(route).items.map(item => item.capabilityId)).toContain("support.ticket.get");
  });

  it("reuses a shortlist without another ranking call and refuses foreign or reconstructed results", async () => {
    const { h, input, route } = await fixture();
    const rank = vi.fn(({ documents }) => documents.map((doc: any) => ({ capabilityId: doc.capabilityId,
      scores: { lexical: 0.5, final: 0.5, semantic: null, aliasPhrase: 0 } })));
    const api = createCapabilityDiscovery({ registry: h.registry, ranker: { version: "test.v1", rank } });
    const [result] = await api.search(input);
    const router = api.routerFor(result!);
    const exported = router.route(route);
    expect(router.route(route)).toEqual(exported);
    expect(rank).toHaveBeenCalledTimes(1);
    expect(() => api.routerFor(structuredClone(result!))).toThrow("not issued");
    expect(() => createCapabilityDiscovery({ registry: h.registry }).routerFor(result!)).toThrow("not issued");
    const limited = router.route({ ...route, maxCapabilities: 1 });
    expect(limited.items).toHaveLength(1);
    expect(limited.excluded.some(item => item.capabilityId === exported.items[1]?.capabilityId)).toBe(true);
  });

  it.each(["source", "registry", "permission", "identity", "run", "request", "task", "facts", "controls"])(
    "fails closed when %s changes after search", async change => {
      const { h, api, input, route } = await fixture();
      let denied = false;
      const controls = { evaluate: () => ({ status: denied ? "denied" as const : "allowed" as const,
        reasons: [], warnings: [], matchedKillSwitches: [], matchedCircuitBreakers: [] }) };
      const [result] = await api.search({ ...input, controls });
      if (change === "source") h.registry.capabilities[0].manifest.model_description += " changed";
      if (change === "registry") h.registry.capabilities.length = 0;
      if (change === "permission") h.runtimeContext.subject.permissions = [];
      if (change === "identity") h.runtimeContext.subject.userId = "another-user";
      if (change === "run") h.runtimeContext.runId = "another-run";
      if (change === "request") h.runtimeContext.requestId = "another-request";
      if (change === "task") route.userInput = { text: "another task" };
      if (change === "facts") h.runtimeContext.facts = { changed: true };
      if (change === "controls") denied = true;
      const exported = api.routerFor(result!).routeWithDiagnostics(route);
      expect(exported.slice.items).toEqual([]);
      expect(exported.discovery[0]).toMatchObject({ status: "unavailable", candidates: [], diagnostics: [{ code: "stale_binding" }] });
    }
  );

  it("carries permission overrides and eligibility filters without permitting their replacement", async () => {
    const { api, input, route } = await fixture();
    const permissions = { "support.ticket.get": { allowed: false, permissions: [] } };
    const [denied] = await api.search({ ...input, eligibility: { capabilityPermissions: permissions } });
    expect(denied?.status).toBe("no_match");
    const [limited] = await api.search({ ...input, eligibility: { includeCapabilityIds: ["support.ticket.get"] } });
    expect(api.routerFor(limited!).route(route).items).toHaveLength(1);
    expect(api.routerFor(limited!).route({ ...route, includeCapabilityIds: ["support.refund.prepare_case"] }).items).toEqual([]);
    expect(api.routerFor(limited!).route({ ...route, excludeCapabilityIds: ["support.ticket.get"] }).items).toEqual([]);
  });

  it.each([{ includeRestricted: "true" }, { includeCapabilityIds: "ticket" }, { maxRiskTier: "none" },
    { capabilityPermissions: { "support.ticket.get": { allowed: true, permissions: "ticket.read" } } }])(
    "rejects malformed eligibility %j", async eligibility => {
      const { api, input } = await fixture();
      await expect(api.search({ ...input, eligibility } as never)).rejects.toMatchObject({ code: "invalid_input" });
    }
  );

  it("handles empty batches and tokenless tasks without dropping their associations", async () => {
    const { api, input, route } = await fixture();
    expect(await api.search({ ...input, tasks: [] })).toEqual([]);
    const results = await api.search({ ...input, tasks: [{ id: "empty", text: "" }, { id: "punctuation", text: "---" }] });
    expect(results.map(result => [result.queryId, result.status])).toEqual([["empty", "no_match"], ["punctuation", "no_match"]]);
    expect(api.routerFor(results[0]!).route({ ...route, userInput: { text: "" } }).warnings[0]?.code).toBe("discovery_no_match");
  });

  it.each([
    [{ id: "same", text: "ticket" }, { id: "same", text: "refund" }],
    [{ id: " ", text: "ticket" }], [{ id: "one", text: 1 }], [{ id: "one", text: "ticket", extra: true }],
    [undefined], Array.from({ length: 9 }, (_, id) => ({ id: String(id), text: "ticket" })),
    [{ id: "one", text: "a".repeat(4001) }]
  ])("rejects malformed or oversized tasks before context building: %j", async tasks => {
    const { h, input } = await fixture();
    const build = vi.fn();
    const api = createCapabilityDiscovery({ registry: h.registry, contextBuilder: { build } });
    await expect(api.search({ ...input, tasks } as never)).rejects.toMatchObject({ name: "DiscoveryError" });
    expect(build).not.toHaveBeenCalled();
  });

  it("honors cancellation before and after search, and the earlier absolute deadline", async () => {
    const { api, input, route } = await fixture();
    const controller = new AbortController();
    const [issued] = await api.search({ ...input, signal: controller.signal });
    controller.abort();
    expect(api.routerFor(issued!).route(route).warnings[0]?.code).toBe("discovery_cancelled");
    expect((await api.search({ ...input, signal: controller.signal }))[0]?.status).toBe("cancelled");
    expect((await api.search({ ...input, deadlineAt: Date.now() - 1 }))[0]?.diagnostics[0]?.code).toBe("deadline_exceeded");
  });

  it("defaults to a 30-second deadline and accepts a caller context builder", async () => {
    const { h, input, route } = await fixture();
    const build = vi.fn(h.contextBuilder.build.bind(h.contextBuilder));
    const api = createCapabilityDiscovery({ registry: h.registry, contextBuilder: { build } });
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const [result] = await api.search(input);
      expect(build).toHaveBeenCalledTimes(1);
      vi.mocked(Date.now).mockReturnValue(now + 30_000);
      expect(api.routerFor(result!).route(route).warnings[0]?.code).toBe("discovery_cancelled");
    } finally { vi.mocked(Date.now).mockRestore(); }
  });
});

describe("explicit hybrid facade", () => {
  it("uses standard weights and bounds, a host budget, and no duplicate query embedding", async () => {
    const { h, input, route } = await fixture();
    const client = new DeterministicMockEmbeddingClient();
    const budget = createInMemoryDiscoveryBudget({ runId: h.runtimeContext.runId, maxProviderCalls: 3, maxInputTokens: 12_000 });
    const built = await buildCapabilityEmbeddingIndex({ corpus: buildCapabilitySearchCorpus(h.registry), client,
      budget: budget.ledger, execution: { budgetPolicy: budget.policy, limits: { maxInputTokens: 4000,
        maxCharactersPerText: 16_384, maxCharactersPerCall: 65_536 } }, limits: embeddingIndexLimits,
      batchSize: 3, maxProviderCalls: 1, deadlineAt: Date.now() + 10_000, runId: h.runtimeContext.runId, requestId: h.runtimeContext.requestId });
    if (built.status !== "built") throw new Error("Fixture must build.");
    const options = { registry: h.registry, mode: "hybrid" as const, embedding: { client, index: built.index, maxInputTokens: 4000 } };
    const api = createCapabilityDiscovery(options);
    const hostBudget = { policy: budget.policy, ledger: {
      reserve: vi.fn(budget.ledger.reserve), settle: vi.fn(budget.ledger.settle)
    } };
    const [result] = await api.search({ ...input, budget: hostBudget });
    expect(result?.actualMode).toBe("hybrid");
    expect(result?.indexFingerprint).toBe(built.index.indexFingerprint);
    expect(client.calls[1]).toMatchObject({ maxInputTokens: 4000 });
    expect(client.calls[1].deadlineAt - Date.now()).toBeLessThanOrEqual(30_000);
    for (const candidate of result!.candidates) expect(candidate.scores.final).toBeCloseTo(
      0.75 * candidate.scores.semantic! + 0.25 * candidate.scores.lexical, 14);
    expect(api.routerFor(result!).route(route).items.length).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(2);
    expect(hostBudget.ledger.reserve).toHaveBeenCalledTimes(1);
    expect(hostBudget.ledger.settle).toHaveBeenCalledTimes(1);
    const invalid = createCapabilityDiscovery({ ...options, embedding: { ...options.embedding, index: {} } });
    expect((await invalid.search({ ...input, budget }))[0]?.status).toBe("unavailable");
    expect(client.calls).toHaveLength(2);
    await expect(api.search(input)).rejects.toMatchObject({ code: "invalid_configuration" });
    const changed = createCapabilityDiscovery({ ...options, weights: { semantic: 0.5, lexical: 0.5 } });
    const [changedResult] = await changed.search({ ...input, budget });
    expect(changedResult?.retrievalPolicyFingerprint).not.toBe(result?.retrievalPolicyFingerprint);
    expect(client.calls).toHaveLength(3);
  });

  it.each([{}, { mode: "semantic" }, { timeoutMs: 0 }, { weights: { semantic: 1, lexical: 0 } }, { embedding: {} },
    { mode: "hybrid", embedding: { maxInputTokens: 0 } }, { unknown: true }])("validates configuration %j", async patch => {
    const { h } = await fixture();
    if (Object.keys(patch).length) expect(() => createCapabilityDiscovery({ registry: h.registry, ...patch } as never)).toThrow();
    else expect(() => createCapabilityDiscovery({ registry: h.registry })).not.toThrow();
  });
});
