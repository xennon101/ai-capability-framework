import { describe, expect, it } from "vitest";
import { CapabilityDiscoverer, createDiscoverySnapshot, validateDiscoverySnapshot, replayDiscoverySnapshot, createDiscoveryReplayHandler,
  buildCapabilitySearchCorpus, buildCapabilityEmbeddingIndex } from "../../discovery/index.js";
import { fingerprintDiscoveryValue, hashDiscoveryContent } from "../../discovery/fingerprint.js";
import { DefaultReplayRecorder, runReplay, validateReplayTrace } from "../../replay/index.js";
import { createDiscoveryExample } from "../../../examples/12-capability-discovery-selection/discovery-example.mjs";
import { DeterministicMockEmbeddingClient, MockDiscoveryBudget, embeddingIndexLimits, embeddingExecution } from "../../../examples/12-capability-discovery-selection/mock-embeddings.mjs";

async function fixture() {
  const h = await createDiscoveryExample();
  const routeRequest = { registry: h.registry, builtContext: h.builtContext, userInput: h.userInput };
  const configuration = { mode: "lexical" as const, policyVersion: "replay.test.v1" };
  const queries = [{ id: "one", fragments: [{ key: "task", text: "Read ticket TCK-100." }] }];
  const discovery = await new CapabilityDiscoverer(configuration).discover({ routeRequest, queries, runId: h.runtimeContext.runId, requestId: h.runtimeContext.requestId });
  const snapshot = createDiscoverySnapshot({ routeRequest, configuration, queries, discovery });
  const trace = new DefaultReplayRecorder().record({ runId: h.runtimeContext.runId, capabilitySlice: { capabilityIds: snapshot.tasks[0]!.candidates.map(item => item.capabilityId) },
    capabilityVersions: Object.fromEntries(snapshot.tasks[0]!.candidates.map(item => [item.capabilityId, item.capabilityVersion])),
    context: { contextHash: "context", decisionContext: { permissions: ["ticket.read"], autonomyTier: "A2" } }, extensions: { discovery: snapshot } });
  return { h, routeRequest, configuration, queries, discovery, snapshot, trace };
}
function resign(snapshot: any) { const { snapshotFingerprint: _, ...payload } = snapshot; return { ...payload,
  snapshotFingerprint: hashDiscoveryContent({ kind: "discovery_snapshot", version: "1.0", payload }) }; }

describe("metadata discovery snapshots and deterministic replay", () => {
  it("creates detached deterministic metadata with no request text or vectors", async () => {
    const f = await fixture();
    expect(createDiscoverySnapshot(f).snapshotFingerprint).toBe(f.snapshot.snapshotFingerprint);
    expect(Object.isFrozen(f.snapshot.tasks[0]?.candidates)).toBe(true);
    expect(JSON.stringify(f.snapshot)).not.toContain("Read ticket TCK-100.");
    expect(JSON.stringify(f.snapshot)).not.toContain('"vector"');
    expect(validateReplayTrace(f.trace).valid).toBe(true);
    expect(validateDiscoverySnapshot(f.trace.extensions?.discovery, f.routeRequest).valid).toBe(true);
  });
  it("distinguishes snapshot validation, ranking reproduction and semantic correctness", async () => {
    const f = await fixture();
    expect(replayDiscoverySnapshot(f.snapshot, { mode: "snapshot_validation", routeRequest: f.routeRequest })).toMatchObject({ status: "passed", semanticCorrectnessTested: false });
    expect(replayDiscoverySnapshot(f.snapshot, { mode: "ranking", routeRequest: f.routeRequest }).status).toBe("refused");
    expect(replayDiscoverySnapshot(f.snapshot, { mode: "ranking", routeRequest: f.routeRequest, fixtures: { queries: f.queries } }).status).toBe("passed");
    expect((await runReplay(f.trace, { mode: "router_only", registry: f.h.registry })).status).toBe("refused");
    const replay = await runReplay(f.trace, { mode: "router_only", routerRunner: createDiscoveryReplayHandler({ mode: "ranking", routeRequest: f.routeRequest, fixtures: { queries: f.queries } }) });
    expect(replay.status).toBe("passed");
    expect(replay.steps.find(step => step.name === "model_semantic_correctness")?.status).toBe("skipped");
    expect((await runReplay(f.trace, { mode: "deterministic_mock" })).steps.find(step => step.name === "discovery_ranking")?.status).toBe("skipped");
  });
  it.each(["hash", "source", "candidate", "version", "rank", "extra", "selection", "duplicate", "mode"])("rejects tampered %s even when its envelope is rehashed", async kind => {
    const f = await fixture(), changed: any = structuredClone(f.snapshot), task = changed.tasks[0];
    if (kind === "hash") changed.snapshotFingerprint = "sha256:" + "0".repeat(64);
    if (kind === "source") changed.registrySourceFingerprint = "sha256:" + "0".repeat(64);
    if (kind === "candidate") task.candidates[0].capabilityId = "support.refund.commit_case";
    if (kind === "version") task.candidates[0].capabilityVersion = "999";
    if (kind === "rank") task.candidates[0].rank = 9;
    if (kind === "extra") task.rawPrompt = "private text";
    if (kind === "duplicate") changed.tasks.push(structuredClone(task));
    if (kind === "mode") task.requestedMode = "hybrid";
    if (kind === "selection") task.selection = { status: "selected", capabilityId: "support.refund.commit_case", capabilityVersion: "1.0.0", reasonCode: "supported_candidate", selectorFingerprint: task.retrievalPolicyFingerprint, inputBindingHash: task.queryHash };
    expect(validateDiscoverySnapshot(kind === "hash" ? changed : resign(changed), f.routeRequest).valid).toBe(false);
  });
  it("rejects oversized, accessor-bearing and cyclic snapshots without reading accessors", async () => {
    const f = await fixture(); let called = false;
    expect(validateDiscoverySnapshot(" ".repeat(1024 * 1024 + 1), f.routeRequest).valid).toBe(false);
    const value = Object.defineProperty({}, "schemaVersion", { enumerable: true, get() { called = true; return "1.0"; } });
    expect(validateDiscoverySnapshot(value, f.routeRequest).valid).toBe(false); expect(called).toBe(false);
    const cycle: any = {}; cycle.self = cycle;
    expect(validateDiscoverySnapshot(cycle, f.routeRequest).valid).toBe(false);
  });
  it("requires matching custom ranker fixtures and detects changed queries and eligibility", async () => {
    const f = await fixture();
    const ranker = { version: "custom.test.v1", rank: ({ documents }: any) => documents.map((doc: any) => ({ capabilityId: doc.capabilityId,
      scores: { lexical: 0.5, final: 0.5, semantic: null, aliasPhrase: 0 } })) };
    const discovery = await new CapabilityDiscoverer(f.configuration, { ranker }).discover({ routeRequest: f.routeRequest, queries: f.queries, runId: f.h.runtimeContext.runId, requestId: f.h.runtimeContext.requestId });
    const snapshot = createDiscoverySnapshot({ ...f, discovery, ranker });
    expect(replayDiscoverySnapshot(snapshot, { mode: "ranking", routeRequest: f.routeRequest, fixtures: { queries: f.queries } }).status).toBe("refused");
    expect(replayDiscoverySnapshot(snapshot, { mode: "ranking", routeRequest: f.routeRequest, fixtures: { queries: f.queries, ranker } }).status).toBe("passed");
    expect(replayDiscoverySnapshot(snapshot, { mode: "ranking", routeRequest: f.routeRequest, fixtures: { queries: [{ id: "one", fragments: [{ key: "task", text: "changed" }] }], ranker } }).status).toBe("refused");
    f.h.runtimeContext.subject.permissions = [];
    expect(validateDiscoverySnapshot(snapshot, f.routeRequest).valid).toBe(false);
  });
  it("replays hybrid ranking from compatible host vectors without making a query call", async () => {
    const f = await fixture(), client = new DeterministicMockEmbeddingClient(), budget = new MockDiscoveryBudget(), deadlineAt = Date.now() + 30_000;
    const built = await buildCapabilityEmbeddingIndex({ corpus: buildCapabilitySearchCorpus(f.h.registry), client, budget, execution: embeddingExecution,
      limits: embeddingIndexLimits, batchSize: 10, maxProviderCalls: 1, runId: f.h.runtimeContext.runId, requestId: f.h.runtimeContext.requestId, deadlineAt });
    expect(built.status).toBe("built"); if (built.status !== "built") return;
    const configuration = { ...f.configuration, mode: "hybrid" as const, weights: { semantic: 0.75, lexical: 0.25 }, failurePolicy: "unavailable" as const };
    const discovery = await new CapabilityDiscoverer(configuration, { embedding: { client, index: built.index, indexLimits: embeddingIndexLimits, execution: embeddingExecution } })
      .discover({ routeRequest: f.routeRequest, queries: f.queries, budget, deadlineAt, runId: f.h.runtimeContext.runId, requestId: f.h.runtimeContext.requestId });
    const snapshot = createDiscoverySnapshot({ ...f, configuration, discovery }), calls = client.calls.length;
    const fixtures = { queries: f.queries, index: built.index, embedding: client.configuration, mock: true, indexLimits: embeddingIndexLimits,
      queryVectors: { one: { queryHash: snapshot.tasks[0]!.queryHash, configurationFingerprint: fingerprintDiscoveryValue("embedding_configuration", client.configuration), vector: [1, 0] } } };
    expect(replayDiscoverySnapshot(snapshot, { mode: "ranking", routeRequest: f.routeRequest, fixtures }).status).toBe("passed");
    expect(client.calls).toHaveLength(calls);
    expect(replayDiscoverySnapshot(snapshot, { mode: "ranking", routeRequest: f.routeRequest, fixtures: { ...fixtures, queryVectors: {} } }).status).toBe("refused");
  });
});
