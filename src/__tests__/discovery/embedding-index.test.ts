import { describe, expect, it } from "vitest";
import { buildRegistry } from "../../index.js";
import { buildCapabilitySearchCorpus } from "../../discovery/corpus.js";
import { buildCapabilityEmbeddingIndex } from "../../discovery/index-builder.js";
import {
  embeddingIndexFingerprint, validateCapabilityEmbeddingIndex, serializeCapabilityEmbeddingIndex,
  parseCapabilityEmbeddingIndex, loadCapabilityEmbeddingIndex, publishCapabilityEmbeddingIndex
} from "../../discovery/index-validation.js";
import { fingerprintDiscoveryValue, hashDiscoveryContent } from "../../discovery/fingerprint.js";
import { semanticSimilarity } from "../../discovery/vectors.js";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import {
  DeterministicMockEmbeddingClient, MockDiscoveryBudget, embeddingIndexLimits, embeddingExecution
} from "../../../examples/12-capability-discovery-selection/mock-embeddings.mjs";

async function fixture() {
  const harness = await createDiscoveryExample();
  const corpus = buildCapabilitySearchCorpus(harness.registry);
  const client = new DeterministicMockEmbeddingClient();
  const budget = new MockDiscoveryBudget();
  const request = {
    corpus, client, budget, execution: structuredClone(embeddingExecution), limits: { ...embeddingIndexLimits },
    runId: "run_example", requestId: "request_example", deadlineAt: Date.now() + 10_000,
    batchSize: 2, maxProviderCalls: 2
  };
  const built = await buildCapabilityEmbeddingIndex(request);
  if (built.status !== "built") throw new Error("Fixture must build.");
  const expected = { corpus, configuration: client.configuration, mock: true, limits: embeddingIndexLimits };
  return { harness, request, built, expected };
}

describe("explicit embedding index construction and bindings", () => {
  it("builds only approved text, sorted and batched, with complete additive mocked usage", async () => {
    const { request, built } = await fixture();
    expect(request.client.calls.flatMap(call => call.texts)).toEqual(request.corpus.documents.map(document => document.text));
    expect(request.client.calls.map(call => call.texts.length)).toEqual([2, 1]);
    expect(built.index.entries.map(entry => entry.capabilityId)).toEqual([...built.index.entries.map(entry => entry.capabilityId)].sort());
    expect(built.usage.totals.providerAttempts).toBe(2);
    expect(built.usage.totals.completedResponses).toBe(2);
    expect(built.usage.totals.inputTokens.complete).toBe(true);
    expect(built.usage.totals.inputTokens.total).toBe(built.usage.stages.reduce((sum, stage) => sum + stage.inputTokens.total!, 0));
    expect(built.usage.stages.every(stage => stage.mock && !stage.pending && stage.outcome === "completed")).toBe(true);
    expect(request.budget.settlements).toHaveLength(2);
    expect(request.budget.outstanding.size).toBe(0);
    expect(Object.isFrozen(built.index.entries[0]!.vector)).toBe(true);
  });

  it("binds canonical configuration, vectors, content and provenance independently of timestamp/order", async () => {
    const { built, expected } = await fixture();
    const changed = structuredClone(built.index);
    changed.entries.reverse(); changed.builtAt = "2026-01-02T03:04:05.000Z";
    expect(embeddingIndexFingerprint(changed)).toBe(built.index.indexFingerprint);
    expect(validateCapabilityEmbeddingIndex(changed, expected).valid).toBe(true);
    expect(hashDiscoveryContent([1, 0])).not.toBe(hashDiscoveryContent([0, 1]));
    expect(fingerprintDiscoveryValue("embedding_configuration", expected.configuration)).toBe(built.index.embeddingConfigurationFingerprint);
    const reordered = { dimensions: 2, revision: "1", configurationId: "example.embedding.v1", model: "synthetic-vectors", provider: "mock" };
    expect(fingerprintDiscoveryValue("embedding_configuration", reordered)).toBe(built.index.embeddingConfigurationFingerprint);
    changed.mock = false;
    expect(embeddingIndexFingerprint(changed)).not.toBe(built.index.indexFingerprint);
  });

  it("never exposes a partial index after a failed batch", async () => {
    const { request } = await fixture();
    request.client.calls.length = 0;
    const original = request.client.embed.bind(request.client);
    request.client.embed = async input => {
      if (request.client.calls.length) throw Object.assign(new Error("private provider body"), { usage: { inputTokens: 3 }, providerAttempts: 1 });
      return original(input);
    };
    const result = await buildCapabilityEmbeddingIndex(request);
    expect(result).toMatchObject({ status: "unavailable", index: null, diagnostics: [{ code: "provider_unavailable" }] });
    expect(result.usage.totals.providerAttempts).toBe(2);
    expect(result.usage.totals.inputTokens.knownSubtotal).toBeGreaterThan(3);
    expect(result.usage.totals.totalTokens.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private provider body");
  });

  it("preserves an absent revision and optional dimensions without claiming an immutable model revision", async () => {
    const { request } = await fixture();
    delete request.client.configuration.revision;
    delete request.client.configuration.dimensions;
    const result = await buildCapabilityEmbeddingIndex(request);
    expect(result.status).toBe("built");
    if (result.status === "built") {
      expect(result.index.embedding.revision).toBeUndefined();
      expect(result.index.embedding.dimensions).toBeUndefined();
      expect(result.index.vectorDimension).toBe(2);
    }
  });

  it("preflights every batch and the complete artifact before spending", async () => {
    const { request } = await fixture();
    const cases = [
      { maxProviderCalls: 1 },
      { limits: { ...request.limits, maxEntries: 1 } },
      { limits: { ...request.limits, maxArtifactBytes: 100 } },
      { limits: { ...request.limits, maxVectorDimension: 1 } },
      { execution: { ...request.execution, limits: { ...request.execution.limits, maxCharactersPerText: 1 } } }
    ];
    for (const patch of cases) {
      request.client.calls.length = 0;
      await expect(buildCapabilityEmbeddingIndex({ ...request, ...patch })).rejects.toBeInstanceOf(Error);
      expect(request.client.calls).toEqual([]);
    }
    const empty = await buildCapabilityEmbeddingIndex({ ...request, corpus: buildCapabilitySearchCorpus(buildRegistry([])) });
    expect(empty).toMatchObject({ status: "unavailable", index: null });
    expect(empty.usage.totals.providerAttempts).toBe(0);
  });
});

describe("strict index validation", () => {
  it.each([
    ["substituted ID", index => { index.entries[0].capabilityId = "support.ticket.substituted"; }],
    ["duplicate ID", index => { index.entries[1].capabilityId = index.entries[0].capabilityId; }],
    ["missing ID", index => { index.entries.pop(); }],
    ["extra ID", index => { index.entries.push(structuredClone(index.entries[0])); }],
    ["wrong version", index => { index.entries[0].capabilityVersion = "9.0.0"; }],
    ["document hash", index => { index.entries[0].documentHash = "sha256:" + "0".repeat(64); }],
    ["vector hash", index => { index.entries[0].vectorHash = "sha256:" + "0".repeat(64); }],
    ["missing vector hash", index => { delete index.entries[0].vectorHash; }],
    ["source", index => { index.registrySourceFingerprint = "sha256:" + "0".repeat(64); }],
    ["corpus", index => { index.corpusFingerprint = "sha256:" + "0".repeat(64); }],
    ["projection", index => { index.projectionVersion = "other.v1"; }],
    ["schema", index => { index.schemaVersion = "2.0"; }],
    ["index hash", index => { index.indexFingerprint = "sha256:" + "0".repeat(64); }],
    ["configuration hash", index => { index.embeddingConfigurationFingerprint = "sha256:" + "0".repeat(64); }],
    ["unknown fields", index => { index.extra = true; }],
    ["invalid date", index => { index.builtAt = "2026-02-30T00:00:00.000Z"; }],
    ["date shape", index => { index.builtAt = "today"; }],
    ["dimension", index => { index.vectorDimension = 1; }],
    ["zero norm", index => { index.entries[0].vector = [0, 0]; }],
    ["short vector", index => { index.entries[0].vector = [1]; }],
    ["empty vector", index => { index.entries[0].vector = []; }],
    ["nonnumeric", index => { index.entries[0].vector = ["1", 0]; }],
    ["nonfinite", index => { index.entries[0].vector = [Infinity, 0]; }],
    ["NaN", index => { index.entries[0].vector = [NaN, 0]; }],
    ["sparse", index => { index.entries[0].vector = new Array(2); }],
    ["array properties", index => { index.entries[0].vector.extra = 1; }]
  ] as [string, (value: any) => void][])("rejects %s", async (_, change) => {
    const { built, expected } = await fixture();
    const index = structuredClone(built.index); change(index);
    expect(validateCapabilityEmbeddingIndex(index, expected)).toMatchObject({
      valid: false, diagnostics: [{ code: _ === "configuration hash" ? "embedding_configuration_mismatch" : "invalid_index" }]
    });
  });

  it.each([
    { provider: "other" }, { model: "other" }, { configurationId: "other" }, { revision: "2" }, { dimensions: 3 }
  ])("rejects mismatched complete embedding identity %j", async (patch) => {
    const { built, expected } = await fixture();
    expect(validateCapabilityEmbeddingIndex(built.index, { ...expected, configuration: { ...expected.configuration, ...patch } }))
      .toMatchObject({ valid: false, diagnostics: [{ code: "embedding_configuration_mismatch" }] });
    expect(validateCapabilityEmbeddingIndex(built.index, { ...expected, mock: false }).valid).toBe(false);
  });

  it("detaches snapshots, checks bounds, rejects malformed values without executing accessors", async () => {
    const { built, expected } = await fixture();
    const value = structuredClone(built.index);
    const validated = validateCapabilityEmbeddingIndex(value, expected);
    expect(validated.valid).toBe(true);
    value.entries[0]!.vector[0] = 99;
    if (validated.valid) expect(validated.index.entries[0]!.vector[0]).not.toBe(99);
    expect(validateCapabilityEmbeddingIndex(built.index, { ...expected, limits: { ...expected.limits, maxVectorDimension: 1 } }).valid).toBe(false);
    let accessed = false;
    Object.defineProperty(value, "entries", { enumerable: true, get() { accessed = true; throw new Error("private"); } });
    expect(validateCapabilityEmbeddingIndex(value, expected).valid).toBe(false);
    expect(accessed).toBe(false);
    for (const invalid of [null, undefined, [], {}, new Date()]) expect(validateCapabilityEmbeddingIndex(invalid, expected).valid).toBe(false);
  });

  it("keeps storage caller-owned and validates complete serialized artifacts on load/publish", async () => {
    const { built, expected } = await fixture();
    const values = new Map<string, string>();
    const store = { read: async (key: string) => values.get(key) ?? null, replace: async (key: string, value: string) => { values.set(key, value); } };
    expect((await loadCapabilityEmbeddingIndex(store, "missing", expected)).valid).toBe(false);
    expect((await publishCapabilityEmbeddingIndex(store, "index", built.index, expected)).published).toBe(true);
    expect((await loadCapabilityEmbeddingIndex(store, "index", expected)).valid).toBe(true);
    expect(parseCapabilityEmbeddingIndex(serializeCapabilityEmbeddingIndex(built.index, expected), expected).valid).toBe(true);
    for (const text of ["{", "{}", " ".repeat(expected.limits.maxArtifactBytes + 1)]) {
      expect(parseCapabilityEmbeddingIndex(text, expected).valid).toBe(false);
    }
    values.set("index", "{");
    expect((await loadCapabilityEmbeddingIndex(store, "index", expected)).valid).toBe(false);
    expect((await publishCapabilityEmbeddingIndex(store, "index", {}, expected)).published).toBe(false);
    expect(values.get("index")).toBe("{");
  });
});

describe("stable exact-dimension cosine", () => {
  it("clamps negative similarity, preserves zero and handles extreme finite components", () => {
    expect(semanticSimilarity([1, 0], [1, 0])).toBe(1);
    expect(semanticSimilarity([1, 0], [0, 1])).toBe(0);
    expect(semanticSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(semanticSimilarity([1e308, 1e308], [1e308, 1e308])).toBeCloseTo(1, 15);
    expect(semanticSimilarity([5e-324, 0], [1e-300, 0])).toBe(1);
    expect(() => semanticSimilarity([1], [1, 0])).toThrow();
    expect(() => semanticSimilarity([0, 0], [1, 0])).toThrow();
  });
});
