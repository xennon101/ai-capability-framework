import { describe, expect, it, vi } from "vitest";
import { buildRegistry, type CapabilityManifest, type LoadedCapabilityManifest } from "../../index.js";
import {
  buildCapabilitySearchCorpus, buildCapabilityEmbeddingIndex, CapabilityDiscoverer, RetrievalCapabilityRouter,
  type CapabilityDiscoveryRequest, type HybridDiscoveryConfiguration
} from "../../discovery/index.js";
import { runHybridExample } from "../../../examples/12-capability-discovery-selection/hybrid-example.mjs";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import {
  DeterministicMockEmbeddingClient, MockDiscoveryBudget, embeddingExecution, embeddingIndexLimits
} from "../../../examples/12-capability-discovery-selection/mock-embeddings.mjs";

const configuration: HybridDiscoveryConfiguration = {
  mode: "hybrid", policyVersion: "test.hybrid.v1", weights: { semantic: 0.5, lexical: 0.5 }, failurePolicy: "unavailable"
};
async function fixture(entries?: LoadedCapabilityManifest[], vectorForText?: (text: string) => number[]) {
  const harness = await createDiscoveryExample();
  if (entries) harness.registry = buildRegistry(entries);
  const corpus = buildCapabilitySearchCorpus(harness.registry);
  const client = new DeterministicMockEmbeddingClient(vectorForText);
  const budget = new MockDiscoveryBudget();
  const built = await buildCapabilityEmbeddingIndex({
    corpus, client, budget, runId: "run_example", requestId: "request_example", deadlineAt: Date.now() + 10_000,
    limits: embeddingIndexLimits, execution: embeddingExecution, batchSize: 3, maxProviderCalls: 2
  });
  if (built.status !== "built") throw new Error("Fixture must build.");
  client.calls.length = 0;
  const request: CapabilityDiscoveryRequest = {
    routeRequest: { registry: harness.registry, builtContext: harness.builtContext, userInput: { text: "ticket" } },
    queries: [{ id: "one", fragments: [{ key: "request", text: "ticket" }] }],
    runId: "run_example", requestId: "request_example", deadlineAt: Date.now() + 10_000, budget
  };
  const embedding = { client, index: built.index, indexLimits: embeddingIndexLimits, execution: structuredClone(embeddingExecution) };
  const engine = (patch: Partial<HybridDiscoveryConfiguration> = {}, dependencies = embedding, ranker?: any) =>
    new CapabilityDiscoverer({ ...configuration, ...patch }, { embedding: dependencies, ranker });
  return { harness, request, embedding, engine, client, built, budget };
}

describe("hybrid scoring and independent task discovery", () => {
  it("finds zero-lexical candidates and retains the hybrid formula for semantic zero", async () => {
    const { request, engine } = await fixture();
    request.queries[0]!.fragments[0]!.text = "case details";
    const [result] = await engine().discover(request);
    expect(result).toMatchObject({ status: "matched", requestedMode: "hybrid", actualMode: "hybrid" });
    expect(result?.indexFingerprint).toMatch(/^sha256:/);
    expect(result?.candidates[0]).toMatchObject({
      capabilityId: "support.ticket.get", scores: { lexical: 0, semantic: 1, final: 0.5 }
    });
    expect(result?.candidates[1]).toMatchObject({
      capabilityId: "support.refund.prepare_case", scores: { lexical: 0.5, semantic: 0, final: 0.25 }
    });
  });

  it.each([
    { semantic: 0, lexical: 1 }, { semantic: 1, lexical: 0 }
  ])("accepts explicit zero weights while retaining hybrid input validation %j", async weights => {
    const { request, engine, client } = await fixture();
    const [result] = await engine({ weights }).discover(request);
    expect(result?.candidates[0]?.scores.final).toBe(1);
    expect(client.calls).toHaveLength(1);
    expect(result?.actualMode).toBe("hybrid");
  });

  it.each([
    undefined, {}, { semantic: -1, lexical: 2 }, { semantic: NaN, lexical: 1 },
    { semantic: Infinity, lexical: 0 }, { semantic: 0.6, lexical: 0.5 }, { semantic: "0.5", lexical: 0.5 },
    { semantic: 0.5, lexical: 0.5, extra: 1 }
  ])("rejects invalid explicit weights %j before any attempt", async weights => {
    const { engine, client } = await fixture();
    expect(() => engine({ weights } as any)).toThrow();
    expect(client.calls).toEqual([]);
  });

  it("binds weights/failure policy and preserves thresholds and positive-score admission", async () => {
    const { request, engine, client } = await fixture();
    request.queries[0]!.fragments[0]!.text = "reimbursement";
    const [first] = await engine({ minRetrievalScore: 0.5 }).discover(request);
    const [higher] = await engine({ minRetrievalScore: 0.5001 }).discover(request);
    expect(first?.candidates[0]?.scores.final).toBe(0.5);
    expect(higher?.status).toBe("no_match");
    expect(first?.retrievalPolicyFingerprint).not.toBe(higher?.retrievalPolicyFingerprint);
    client.vectorForText = () => [-1, -1];
    const [negative] = await engine().discover(request);
    expect(negative?.status).toBe("no_match");
    expect(negative?.candidates).toEqual([]);
    expect(negative?.indexFingerprint).toBeDefined();
  });

  it("joins original fragment texts exactly while excluding keys and retaining fragment-local aliases", async () => {
    const { harness } = await createDiscoveryFixture();
    const loaded = harness.registry.capabilityById.get("support.ticket.get")!;
    loaded.manifest.extensions = { discovery: { schema_version: "1.0", aliases: ["read case"] } };
    const { request, engine, client } = await fixture([loaded]);
    request.queries = [
      { id: "split", fragments: [{ key: "secret-key", text: "read" }, { key: "other-key", text: "case" }] },
      { id: "whole", fragments: [{ key: "secret-key", text: "read case" }] }
    ];
    const results = await engine().discover(request);
    expect(client.calls.map(call => call.texts)).toEqual([["read\ncase"], ["read case"]]);
    expect(results[0]?.candidates.find(candidate => candidate.capabilityId === "support.ticket.get")?.scores.aliasPhrase).toBe(0);
    expect(results[1]?.candidates.find(candidate => candidate.capabilityId === "support.ticket.get")?.scores.aliasPhrase).toBe(1);
  });

  it("processes tasks sequentially with additive usage and independent failed results", async () => {
    const { request, engine, client } = await fixture();
    const original = client.embed.bind(client);
    let active = 0, maximum = 0;
    client.embed = async input => {
      active++; maximum = Math.max(maximum, active);
      await Promise.resolve();
      const response = await original(input);
      active--;
      if (input.texts[0] === "bad") response.vectorDimension = 3;
      return response;
    };
    request.queries = ["ticket", "bad", "ticket"].map((text, index) => ({ id: "task_" + index, fragments: [{ key: "request", text }] }));
    const result = await engine().discover(request);
    expect(maximum).toBe(1);
    expect(client.calls.map(call => call.texts)).toEqual([["ticket"], ["bad"], ["ticket"]]);
    expect(result.map(entry => entry.queryId)).toEqual(["task_0", "task_1", "task_2"]);
    expect(result.map(entry => entry.status)).toEqual(["matched", "unavailable", "matched"]);
    expect(result[0]?.candidates).toEqual(result[2]?.candidates);
    expect(result.reduce((sum, entry) => sum + entry.usage.totals.providerAttempts, 0)).toBe(3);
  });

  it("applies deterministic ties, thresholds, alias diversity and host lexical hooks before framework fusion", async () => {
    const harness = await createDiscoveryExample();
    const original = harness.registry.capabilityById.get("support.ticket.get")!;
    const entries = ["alpha", "beta", "gamma"].map((suffix, index): LoadedCapabilityManifest => ({
      ...structuredClone(original), manifest: {
        ...structuredClone(original.manifest), id: "support.ticket." + suffix, name: "Lookup",
        summary: index === 2 ? "Details" : "read case extra",
        ...(index === 2 ? { extensions: { discovery: { schema_version: "1.0", aliases: ["read case"] } } } : {})
      }
    }));
    const { request, engine, embedding, client } = await fixture(entries, () => [1, 0]);
    request.queries[0]!.fragments[0]!.text = "read case extra";
    const [diverse] = await engine({ limits: { maxCandidates: 2, aliasDiversitySlots: 1 } }).discover(request);
    expect(diverse?.candidates.map(candidate => candidate.capabilityId)).toEqual(["support.ticket.alpha", "support.ticket.gamma"]);
    expect(diverse?.candidates[1]?.inclusionReason).toBe("alias_diversity");
    const [threshold] = await engine({ limits: { maxCandidates: 2, aliasDiversitySlots: 1 }, minRetrievalScore: 0.9 }).discover(request);
    expect(threshold?.candidates.map(candidate => candidate.capabilityId)).toEqual(["support.ticket.alpha", "support.ticket.beta"]);
    const hook = { version: "host.v1", rank: ({ documents }) => [{
      capabilityId: documents[1].capabilityId, scores: { lexical: 0.1, aliasPhrase: 0, semantic: null, final: 0.1 }
    }] };
    const [custom] = await engine({}, embedding, hook).discover(request);
    expect(custom?.candidates.map(candidate => candidate.capabilityId)).toEqual(["support.ticket.beta"]);
    expect(custom?.candidates[0]?.scores.final).toBe(0.55);
    const before = client.calls.length;
    hook.rank = ({ documents }) => [{
      capabilityId: documents[0].capabilityId, scores: { lexical: 0.1, aliasPhrase: 0, semantic: null, final: 0.8 }
    }];
    const [invalid] = await engine({ failurePolicy: "lexical_fallback" }, embedding, hook).discover(request);
    expect(invalid?.diagnostics[0]?.code).toBe("invalid_ranker_output");
    expect(client.calls).toHaveLength(before);
  });
});

async function createDiscoveryFixture() { return { harness: await createDiscoveryExample() }; }

describe("hybrid guard and explicit degradation boundaries", () => {
  it("rejects invalid indexes and same-count ID substitution before purchasing query embeddings", async () => {
    const { request, engine, embedding, client } = await fixture();
    const index = structuredClone(embedding.index);
    index.entries[0]!.capabilityId = "support.ticket.substituted";
    const [result] = await engine({}, { ...embedding, index }).discover(request);
    expect(result).toMatchObject({ status: "unavailable", actualMode: null, diagnostics: [{ code: "invalid_index" }] });
    expect(result?.indexFingerprint).toBeUndefined();
    expect(client.calls).toEqual([]);
  });

  it.each(["model", "dimensions", "revision", "mock"])("rejects query/index %s mismatches before an attempt", async key => {
    const { request, engine, client } = await fixture();
    if (key === "mock") client.mock = false;
    else client.configuration[key] = key === "dimensions" ? 3 : "other";
    const [result] = await engine().discover(request);
    expect(result?.diagnostics[0]?.code).toBe("embedding_configuration_mismatch");
    expect(client.calls).toEqual([]);
  });

  it("falls back for the whole query explicitly and retains failed-attempt usage", async () => {
    const { request, engine, embedding, client } = await fixture();
    const [indexFallback] = await engine({ failurePolicy: "lexical_fallback" }, { ...embedding, index: {} }).discover(request);
    expect(indexFallback).toMatchObject({ status: "matched", requestedMode: "hybrid", actualMode: "lexical", degradedReason: "invalid_index" });
    expect(indexFallback?.indexFingerprint).toBeUndefined(); expect(client.calls).toEqual([]);
    client.embed = async () => { throw Object.assign(new Error("private payload"), { providerAttempts: 1, usage: { inputTokens: 11 } }); };
    const [providerFallback] = await engine({ failurePolicy: "lexical_fallback" }).discover(request);
    expect(providerFallback).toMatchObject({ status: "matched", actualMode: "lexical", degradedReason: "provider_unavailable" });
    expect(providerFallback?.candidates.every(candidate => candidate.scores.semantic === null)).toBe(true);
    expect(providerFallback?.usage.totals.inputTokens.total).toBe(11);
    expect(providerFallback?.usage.totals.estimatedCost.complete).toBe(false);
    expect(JSON.stringify(providerFallback)).not.toContain("private payload");
  });

  it.each(["empty", "tokenless", "ineligible", "cancel", "deadline"])("makes no query calls for %s", async kind => {
    const { request, engine, client } = await fixture();
    if (kind === "empty") request.queries = [];
    if (kind === "tokenless") request.queries[0]!.fragments[0]!.text = "---";
    if (kind === "ineligible") request.routeRequest.includeCapabilityIds = [];
    if (kind === "cancel") { const controller = new AbortController(); controller.abort(); request.signal = controller.signal; }
    if (kind === "deadline") request.deadlineAt = Date.now() - 1;
    const results = await engine({ failurePolicy: "lexical_fallback" }).discover(request);
    expect(client.calls).toEqual([]);
    expect(results.every(result => result.degradedReason === undefined)).toBe(true);
  });

  it("requires provider budget/deadline and preflights all query text before any paid work", async () => {
    const { request, engine, embedding, client } = await fixture();
    await expect(engine().discover({ ...request, budget: undefined })).rejects.toMatchObject({ code: "invalid_configuration" });
    await expect(engine().discover({ ...request, deadlineAt: undefined })).rejects.toMatchObject({ code: "invalid_configuration" });
    embedding.execution.limits.maxCharactersPerText = 6;
    request.queries = ["ticket", "longer text"].map((text, index) => ({ id: "task_" + index, fragments: [{ key: "request", text }] }));
    await expect(engine().discover(request)).rejects.toMatchObject({ code: "input_limit_exceeded" });
    expect(client.calls).toEqual([]);
  });

  it.each(["budget", "controls", "settlement"])("never falls back around %s denial", async kind => {
    const { request, engine, budget, client } = await fixture();
    if (kind === "budget") budget.reserve = async () => ({ status: "denied", diagnostic: { code: "budget_denied", message: "Denied" } });
    if (kind === "controls") request.routeRequest.controls = { evaluate: ({ operation }) => ({
      status: operation === "provider_call" ? "denied" : "allowed", matchedCircuitBreakers: [], matchedKillSwitches: [], reasons: [], warnings: []
    }) };
    if (kind === "settlement") budget.settle = async () => { throw new Error("private"); };
    const [result] = await engine({ failurePolicy: "lexical_fallback" }).discover(request);
    expect(result?.status).toBe("unavailable");
    expect(result?.actualMode).toBeNull();
    expect(result?.degradedReason).toBeUndefined();
    expect(client.calls).toHaveLength(kind === "settlement" ? 1 : 0);
  });

  it("honors the same shared ledger across successive tasks without erasing an earlier result", async () => {
    const { request, engine, embedding, budget } = await fixture();
    embedding.execution.budgetPolicy.maxProviderCallsPerRun = 2; // One build call already consumed.
    request.queries = ["ticket", "ticket"].map((text, index) => ({ id: "task_" + index, fragments: [{ key: "request", text }] }));
    const result = await engine({ failurePolicy: "lexical_fallback" }).discover(request);
    expect(result.map(entry => entry.status)).toEqual(["matched", "unavailable"]);
    expect(result[1]?.diagnostics[0]?.code).toBe("budget_denied");
    expect(budget.settlements).toHaveLength(2);
  });

  it.each(["permissions", "registry", "source"])("discards revoked/stale %s during embedding without fallback", async kind => {
    const { request, engine, client } = await fixture();
    const original = client.embed.bind(client);
    client.embed = async input => {
      const response = await original(input);
      if (kind === "permissions") request.routeRequest.builtContext.runtimeContext.subject.permissions = [];
      if (kind === "registry") request.routeRequest.registry.capabilities.length = 0;
      if (kind === "source") request.routeRequest.registry.capabilityById.get("support.ticket.get")!.manifest.summary = "Changed";
      return response;
    };
    const [result] = await engine({ failurePolicy: "lexical_fallback" }).discover(request);
    expect(result).toMatchObject({ status: "unavailable", candidates: [], diagnostics: [{ code: "stale_binding" }] });
    expect(result?.usage.totals.providerAttempts).toBe(1);
    expect(result?.degradedReason).toBeUndefined();
  });

  it("rechecks eligibility after reservation and blocks custom ranker re-entry", async () => {
    const { request, engine, embedding, client, budget } = await fixture();
    request.routeRequest.excludeCapabilityIds = ["support.ticket.get"];
    const [foreign] = await engine({}, embedding, { version: "host.v1", rank: () => [{
      capabilityId: "support.ticket.get", scores: { lexical: 1, aliasPhrase: 0, semantic: null, final: 1 }
    }] }).discover(request);
    expect(foreign?.diagnostics[0]?.code).toBe("invalid_ranker_output");
    expect(client.calls).toEqual([]);
    request.routeRequest.excludeCapabilityIds = undefined;
    const original = budget.reserve.bind(budget);
    budget.reserve = async input => {
      const value = await original(input);
      request.routeRequest.builtContext.runtimeContext.subject.permissions = [];
      return value;
    };
    const [revoked] = await engine().discover(request);
    expect(revoked?.diagnostics[0]?.code).toBe("stale_binding");
    expect(client.calls).toEqual([]);
  });

  it("invalidates changed metadata without rebuilding or purchasing a query embedding", async () => {
    const { request, engine, client } = await fixture();
    request.routeRequest.registry.capabilityById.get("support.ticket.get")!.manifest.extensions = {
      discovery: { schema_version: "1.0", aliases: ["New alias"] }
    };
    const [result] = await engine().discover(request);
    expect(result?.diagnostics[0]?.code).toBe("invalid_index");
    expect(client.calls).toEqual([]);
  });

  it("keeps empty registries and missing eligibility as no-call outcomes despite a now-stale index", async () => {
    const { request, engine, client } = await fixture();
    request.routeRequest.registry = buildRegistry([]);
    const [result] = await engine().discover(request);
    expect(result).toMatchObject({ status: "no_match", diagnostics: [{ code: "no_eligible_capabilities" }] });
    expect(client.calls).toEqual([]);
  });
});

describe("hybrid native integration", () => {
  it("runs an explicit mock build and authorized ordinary model/tool loop without network or selector calls", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    try {
      const result = await runHybridExample();
      expect(result.mock).toBe(true);
      expect(result.invalidIndexStatus).toBe("unavailable");
      expect(result.invalidIndexQueryCalls).toBe(0);
      expect(result.fallbackMode).toBe("lexical");
      expect(result.logicalEmbeddingAttempts).toBe(3);
      expect(result.embeddingUsage.totals.providerAttempts).toBe(3);
      expect(result.embeddingUsage.totals.completedResponses).toBe(3);
      expect(result.embeddingUsage.totals.inputTokens).toEqual({ total: 83, knownSubtotal: 83, complete: true });
      expect(result.embeddingUsage.stages.every(stage => stage.mock)).toBe(true);
      expect(result.ordinaryMockModelTurns).toBe(2);
      expect(result.toolStatus).toBe("success");
      expect(result.slice.items[0].capabilityId).toBe("support.ticket.get");
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("uses explicit per-request budgets/deadlines and keeps the slice bounded", async () => {
    const { request, embedding, client } = await fixture();
    const router = new RetrievalCapabilityRouter({ mode: "native_tool_selection", discovery: configuration, embedding });
    const routed = await router.routeWithDiagnostics({
      ...request.routeRequest, userInput: { text: "case details" }, maxCapabilities: 1,
      budget: request.budget, deadlineAt: request.deadlineAt
    });
    expect(routed.slice.items).toHaveLength(1);
    expect(routed.discovery[0]?.actualMode).toBe("hybrid");
    expect(routed.selection).toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });

  it("retains billed usage when permissions change after discovery but before returning a router slice", async () => {
    const { request, embedding } = await fixture();
    const original = CapabilityDiscoverer.prototype.discover;
    const spy = vi.spyOn(CapabilityDiscoverer.prototype, "discover").mockImplementation(async function(input) {
      const results = await original.call(this, input);
      request.routeRequest.builtContext.runtimeContext.subject.permissions = [];
      return results;
    });
    try {
      const router = new RetrievalCapabilityRouter({ mode: "native_tool_selection", discovery: configuration, embedding });
      const result = await router.routeWithDiagnostics({ ...request.routeRequest, budget: request.budget, deadlineAt: request.deadlineAt });
      expect(result.slice.items).toEqual([]);
      expect(result.discovery[0]?.diagnostics[0]?.code).toBe("stale_binding");
      expect(result.discovery[0]?.usage.totals.providerAttempts).toBe(1);
      expect(result.discovery[0]?.indexFingerprint).toBeUndefined();
    } finally { spy.mockRestore(); }
  });

  it("exposes explicit degradation in slice-only routing through a safe warning", async () => {
    const { request, embedding, client } = await fixture();
    const router = new RetrievalCapabilityRouter({
      mode: "native_tool_selection", discovery: { ...configuration, failurePolicy: "lexical_fallback" },
      embedding: { ...embedding, index: {} }
    });
    const result = await router.route({ ...request.routeRequest, budget: request.budget, deadlineAt: request.deadlineAt });
    expect(result.items[0]?.capabilityId).toBe("support.ticket.get");
    expect(result.warnings).toEqual([{
      code: "discovery_lexical_fallback", message: "Discovery used the configured whole-query lexical fallback policy."
    }]);
    expect(client.calls).toEqual([]);
  });
});
