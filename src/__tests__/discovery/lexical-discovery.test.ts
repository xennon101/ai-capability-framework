import { describe, expect, it, vi } from "vitest";
import { buildRegistry, loadManifests, type CapabilityManifest, type LoadedCapabilityManifest } from "../../index.js";
import type { CapabilityRouteRequest } from "../../runtime/types.js";
import {
  buildCapabilitySearchCorpus, CapabilityDiscoverer, DiscoveryError, tokenizeDiscoveryText,
  type CapabilityDiscoveryRequest, type CapabilityLexicalRanker, type DiscoveryConfiguration
} from "../../discovery/index.js";

const loaded = await loadManifests({ path: "examples/support" });
const original = loaded.manifests.find((entry) => entry.kind === "capability" && entry.manifest.id === "support.ticket.get")!;
const source = original.manifest as CapabilityManifest;
const config = { mode: "lexical", policyVersion: "test.v1" } as const;

function capability(id: string, patch: Partial<CapabilityManifest> = {}): LoadedCapabilityManifest {
  return {
    kind: "capability", path: "synthetic/" + id + ".yaml", absolutePath: "/synthetic/" + id,
    manifest: { ...structuredClone(source), id, name: "Lookup", summary: "Details", ...patch }
  };
}

function route(capabilities: LoadedCapabilityManifest[], patch: Partial<CapabilityRouteRequest> = {}): CapabilityRouteRequest {
  return {
    registry: buildRegistry(capabilities), userInput: { text: "ticket" },
    builtContext: { items: [], modelContextText: "", redactions: [], warnings: [], runtimeContext: {
      environment: "test", runId: "run_example", requestId: "request_example", startedAt: "2026-01-01T00:00:00Z",
      account: { accountId: "account_example", tenantId: "tenant_example" },
      subject: { actorType: "user", userId: "user_example", permissions: ["ticket.read"], roles: [] },
      autonomy: { autonomyTier: "A2", maxRiskTier: "medium", allowSideEffects: false, allowExternalMessages: false,
        allowMoneyMovement: false, allowPermissionChanges: false }, facts: {}, metadata: {}
    } }, ...patch
  };
}

function request(capabilities: LoadedCapabilityManifest[], texts = ["ticket"], patch: Partial<CapabilityDiscoveryRequest> = {}): CapabilityDiscoveryRequest {
  return {
    runId: "run_example", requestId: "request_example", routeRequest: route(capabilities),
    queries: texts.map((text, index) => ({ id: "task_" + index, fragments: [{ key: "request", text }] })), ...patch
  };
}
const alpha = () => capability("support.ticket.alpha");
const ids = (result: Awaited<ReturnType<CapabilityDiscoverer["discover"]>>[number]) => result.candidates.map((candidate) => candidate.capabilityId);
async function discover(entries: LoadedCapabilityManifest[], texts?: string[], configuration: DiscoveryConfiguration = config) {
  return new CapabilityDiscoverer(configuration).discover(request(entries, texts));
}

describe("capability corpus bindings and approved projection", () => {
  it("is deterministic across registry order and loaded paths, and never mutates sources", () => {
    const a = alpha(), b = capability("support.ticket.beta");
    const before = structuredClone([a, b]);
    const first = buildCapabilitySearchCorpus(buildRegistry([b, a]));
    const relocated = structuredClone(a);
    relocated.path = "different.yaml"; relocated.absolutePath = "/elsewhere";
    const second = buildCapabilitySearchCorpus(buildRegistry([relocated, b]));
    expect(first).toEqual(second);
    expect(first.documents.map((document) => document.capabilityId)).toEqual([a.manifest.id, b.manifest.id]);
    expect([a, b]).toEqual(before);
    expect(first.corpusFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(first.documents[0]?.aliases)).toBe(true);
  });

  it("projects only ID, name, resolved summary and aliases; keeps risk/version structured", async () => {
    const a = capability("support.ticket.alpha", {
      name: "A café", summary: "Fallback field", model_description: "excludedmodel",
      when_to_use: ["excludedguidance"], when_not_to_use: ["excludednegative"], tags: ["excludedtag"],
      domain: "excludeddomain", input_schema: { type: "object", properties: { excludedschema: { type: "string" } } },
      extensions: { discovery: { schema_version: "1.0", summary: "Public résumé", aliases: ["Lookup A", " lookup   a "] } }
    });
    a.path = "excludedpath.yaml";
    const doc = buildCapabilitySearchCorpus(buildRegistry([a])).documents[0]!;
    expect(doc.text).toBe("support.ticket.alpha\nA café\nPublic résumé\nLookup A");
    expect(doc.aliases).toEqual(["Lookup A"]);
    expect(doc.riskTier).toBe(a.manifest.risk_tier);
    expect(doc.capabilityVersion).toBe(a.manifest.version);
    for (const text of ["excludedmodel", "excludedguidance", "excludednegative", "excludedtag", "excludeddomain",
      "excludedschema", "excludedpath", "read", "Fallback", "1.0.0", "low"]) {
      expect((await discover([a], [text]))[0]?.status).toBe("no_match");
    }
  });

  it("invalidates source bindings for guidance changes and document bindings for retrieval or risk/version changes", () => {
    const a = alpha();
    const first = buildCapabilitySearchCorpus(buildRegistry([a]));
    a.manifest.model_description = "Changed model guidance.";
    const guidance = buildCapabilitySearchCorpus(buildRegistry([a]));
    expect(guidance.registrySourceFingerprint).not.toBe(first.registrySourceFingerprint);
    expect(guidance.corpusFingerprint).not.toBe(first.corpusFingerprint);
    expect(guidance.documents[0]?.documentHash).toBe(first.documents[0]?.documentHash);
    for (const patch of [
      { extensions: { discovery: { schema_version: "1.0", aliases: ["new alias"] } } },
      { summary: "New summary" }, { risk_tier: "medium" }, { version: "1.0.1" }
    ] as Partial<CapabilityManifest>[]) {
      const changed = buildCapabilitySearchCorpus(buildRegistry([capability(a.manifest.id, patch)]));
      expect(changed.documents[0]?.documentHash).not.toBe(first.documents[0]?.documentHash);
    }
  });

  it("rejects invalid schemas, metadata, duplicates and inconsistent lookup maps", () => {
    const a = alpha(), b = capability("support.ticket.beta");
    const cases = [
      buildRegistry([a, a]),
      buildRegistry([capability(a.manifest.id, { extensions: { discovery: { schema_version: "2.0" } } })]),
      buildRegistry([capability(a.manifest.id, { summary: 7 as unknown as string })])
    ];
    const missing = buildRegistry([a]); missing.capabilityById.clear(); cases.push(missing);
    const extra = buildRegistry([a]); extra.capabilityById.set(b.manifest.id, b); cases.push(extra);
    const substituted = buildRegistry([a]); substituted.capabilityById.set(a.manifest.id, b); cases.push(substituted);
    for (const registry of cases) expect(() => buildCapabilitySearchCorpus(registry)).toThrow(DiscoveryError);
  });
});

describe("lexical coverage, phrases and shortlist policy", () => {
  it("normalizes Unicode, splits punctuation and identifier separators, and preserves short tokens", async () => {
    expect(tokenizeDiscoveryText("Ａ_b.C-d:é １ x")).toEqual(["a", "b", "c", "d", "é", "1", "x"]);
    const a = capability("support.ticket.alpha", { name: "CAFÉ Ａ １", summary: "東京 x" });
    const [result] = await discover([a], ["café a 1 東京 x"]);
    expect(result?.candidates[0]?.scores).toEqual({ lexical: 1, aliasPhrase: 0, semantic: null, final: 1 });
    expect((await discover([a], ["cafe"]))[0]?.status).toBe("no_match");
  });

  it("uses unique query tokens, no stop words or inferred synonyms, and exact precision", async () => {
    const a = alpha();
    const results = await discover([a], ["ticket ticket missing missing", "ticket missing", "the", "incident"]);
    expect(results[0]?.candidates[0]?.scores.final).toBe(0.5);
    expect(results[1]?.candidates[0]?.scores.final).toBe(0.5);
    expect(results.slice(2).map((result) => result.status)).toEqual(["no_match", "no_match"]);
    const [third] = await discover([a], ["ticket missing absent"]);
    expect(third?.candidates[0]?.scores.final).toBe(1 / 3);
  });

  it("matches complete multi-token authored aliases within one fragment only", async () => {
    const a = capability("support.ticket.alpha", {
      extensions: { discovery: { schema_version: "1.0", aliases: ["Read case", " read  CASE ", "x"] } }
    });
    const engine = new CapabilityDiscoverer({ ...config, aliasWeight: 0.5 });
    const [whole, split, partial, single] = await engine.discover(request([a], [], { queries: [
      { id: "whole", fragments: [{ key: "one", text: "read case extra" }] },
      { id: "split", fragments: [{ key: "one", text: "read" }, { key: "two", text: "case extra" }] },
      { id: "partial", fragments: [{ key: "one", text: "read extra case" }] },
      { id: "single", fragments: [{ key: "one", text: "x" }] }
    ] }));
    const weighted = 2 / 3 + (1 - 2 / 3) * 0.5;
    expect(whole?.candidates[0]?.scores).toEqual({ lexical: weighted, aliasPhrase: 1, semantic: null, final: weighted });
    expect(whole?.candidates[0]?.matchedAliases).toEqual(["Read case"]);
    expect(split?.candidates[0]?.scores.final).toBe(2 / 3);
    expect(partial?.candidates[0]?.scores.aliasPhrase).toBe(0);
    expect(single?.candidates[0]?.matchedAliases).toEqual([]);
    expect((await discover([a], ["read case extra"]))[0]?.candidates[0]?.scores.final).toBe(2 / 3);
  });

  it("orders scores, risk, and IDs deterministically; thresholds are inclusive without zero padding", async () => {
    const a = alpha(), b = capability("support.ticket.beta"), c = capability("support.ticket.gamma", { risk_tier: "medium" });
    const [first] = await discover([c, b, a]);
    const [second] = await discover([a, c, b]);
    expect(ids(first!)).toEqual([a.manifest.id, b.manifest.id, c.manifest.id]);
    expect(second?.candidates).toEqual(first?.candidates);
    expect(first?.candidates.map((candidate) => candidate.rank)).toEqual([1, 2, 3]);
    expect((await discover([a], ["ticket missing"], { ...config, minRetrievalScore: 0.5 }))[0]?.status).toBe("matched");
    expect((await discover([a], ["ticket missing"], { ...config, minRetrievalScore: 0.500001 }))[0]?.status).toBe("no_match");
    expect((await discover([a], ["absent"], { ...config, minRetrievalScore: 0 }))[0]?.candidates).toEqual([]);
  });

  it("reserves one alias alternative, preserving the aggregate winner and admitted scores", async () => {
    const a = capability("support.ticket.alpha", { summary: "read case extra" });
    const b = capability("support.ticket.beta", { summary: "read case extra" });
    const c = capability("support.ticket.gamma", {
      extensions: { discovery: { schema_version: "1.0", aliases: ["read case"] } }
    });
    const [plain] = await discover([c, b, a], ["read case extra"], { ...config, limits: { maxCandidates: 2 } });
    const [diverse] = await discover([c, b, a], ["read case extra"], {
      ...config, limits: { maxCandidates: 2, aliasDiversitySlots: 1 }
    });
    expect(ids(plain!)).toEqual([a.manifest.id, b.manifest.id]);
    expect(ids(diverse!)).toEqual([a.manifest.id, c.manifest.id]);
    expect(diverse?.candidates[1]).toMatchObject({ rank: 2, inclusionReason: "alias_diversity", scores: { final: 2 / 3 } });
    const [threshold] = await discover([c, b, a], ["read case extra"], {
      ...config, minRetrievalScore: 0.9, limits: { maxCandidates: 2, aliasDiversitySlots: 1 }
    });
    expect(ids(threshold!)).toEqual(ids(plain!));
  });

  it("retains task associations and fingerprints effective configuration independently of its label", async () => {
    const input = request([alpha()], ["ticket", "ticket"]);
    const engine = new CapabilityDiscoverer(config);
    const results = await engine.discover(input);
    expect(results.map((result) => result.queryId)).toEqual(["task_0", "task_1"]);
    expect(results[0]?.candidates).toEqual(results[1]?.candidates);
    const explicit = await new CapabilityDiscoverer({ ...config, aliasWeight: 0, minRetrievalScore: 0 }).discover(input);
    expect(explicit[0]?.retrievalPolicyFingerprint).toBe(results[0]?.retrievalPolicyFingerprint);
    const changed = await new CapabilityDiscoverer({ ...config, aliasWeight: 0.2 }).discover(input);
    expect(changed[0]?.policyVersion).toBe(results[0]?.policyVersion);
    expect(changed[0]?.retrievalPolicyFingerprint).not.toBe(results[0]?.retrievalPolicyFingerprint);
    const limited = await engine.discover({ ...input, maxCandidates: 1 });
    expect(limited[0]?.retrievalPolicyFingerprint).not.toBe(results[0]?.retrievalPolicyFingerprint);
  });
});

describe("discovery input validation, eligibility and operational outcomes", () => {
  it.each([
    {}, { mode: "hybrid", policyVersion: "v1", weights: { lexical: 1, semantic: 0 }, failurePolicy: "unavailable" },
    { ...config, extra: true }, { ...config, policyVersion: " " }, { ...config, weights: undefined },
    { ...config, aliasWeight: NaN }, { ...config, aliasWeight: 1.1 }, { ...config, minRetrievalScore: -1 },
    { ...config, minRetrievalScore: Infinity }, { ...config, limits: null }, { ...config, limits: { extra: 1 } },
    ...["maxQueries", "maxFragmentsPerQuery", "maxQueryCharacters", "maxCandidates"].flatMap((key) =>
      [0, -1, 1.5, NaN, Infinity, 100_000, "2"].map((value) => ({ ...config, limits: { [key]: value } }))),
    { ...config, limits: { aliasDiversitySlots: 2 } },
    { ...config, limits: { maxCandidates: 1, aliasDiversitySlots: 1 } }
  ])("rejects malformed or unimplemented configuration %#", (value) => {
    expect(() => new CapabilityDiscoverer(value as DiscoveryConfiguration)).toThrow(DiscoveryError);
  });

  it("enforces batch, fragments, character budgets and IDs before ranking without clipping", async () => {
    const rank = vi.fn(() => []);
    const engine = new CapabilityDiscoverer({
      ...config, limits: { maxQueries: 1, maxFragmentsPerQuery: 1, maxQueryCharacters: 3 }
    }, { ranker: { version: "test.v1", rank } });
    const invalid = [
      { queries: request([], ["a", "b"]).queries },
      { queries: [{ id: "one", fragments: [{ key: "a", text: "" }, { key: "b", text: "" }] }] },
      { queries: [{ id: "one", fragments: [{ key: "a", text: "abcd" }] }] },
      { queries: [{ id: " ", fragments: [] }] }, { queries: [undefined] }, { queries: new Array(1) },
      { queries: [{ id: "one", fragments: [{ key: "a", text: 7 }] }] },
      { queries: [{ id: "one", fragments: [{ key: "a", text: "a", extra: 1 }] }] },
      { queries: [{ id: "one", fragments: [{ key: " ", text: "a" }] }] },
      { runId: "" }, { deadlineAt: NaN }, { signal: {} }, { maxCandidates: 9 }, { maxCandidates: 1.1 }, { maxCandidates: null }
    ];
    for (const patch of invalid) {
      await expect(engine.discover(request([alpha()], [], patch as Partial<CapabilityDiscoveryRequest>))).rejects.toBeInstanceOf(DiscoveryError);
    }
    const normal = new CapabilityDiscoverer(config);
    await expect(normal.discover(request([alpha()], [], {
      queries: [{ id: "same", fragments: [] }, { id: "same", fragments: [] }]
    }))).rejects.toMatchObject({ code: "invalid_input" });
    expect(rank).not.toHaveBeenCalled();
    await expect(engine.discover(request([alpha()], ["abc"]))).resolves.toHaveLength(1);
  });

  it("counts text across all fragments and accepts exact configured boundaries", async () => {
    const engine = new CapabilityDiscoverer({ ...config, limits: { maxQueryCharacters: 6, maxFragmentsPerQuery: 2 } });
    const input = request([alpha()], [], { queries: [{
      id: "one", fragments: [{ key: "one", text: "tic" }, { key: "two", text: "ket" }]
    }] });
    await expect(engine.discover(input)).resolves.toHaveLength(1);
    input.queries[0]!.fragments[1]!.text += "x";
    await expect(engine.discover(input)).rejects.toMatchObject({ code: "input_limit_exceeded" });
  });

  it("handles empty batches, tokenless queries, empty eligibility and empty registries", async () => {
    expect(await discover([], [])).toEqual([]);
    for (const text of ["", " \t\n", "---"]) expect((await discover([alpha()], [text]))[0]).toMatchObject({
      status: "no_match", candidates: [], diagnostics: [{ code: "empty_query" }]
    });
    expect((await discover([]))[0]).toMatchObject({ status: "no_match", diagnostics: [{ code: "no_eligible_capabilities" }] });
    const denied = request([alpha()]); denied.routeRequest.includeCapabilityIds = [];
    expect((await new CapabilityDiscoverer(config).discover(denied))[0]?.status).toBe("no_match");
  });

  it("uses the entire eligible registry beyond the old count prefix", async () => {
    const entries = Array.from({ length: 25 }, (_, index) => capability("support.ticket.item_" + index, {
      summary: index === 24 ? "needle" : "other"
    }));
    const input = request(entries, ["needle"]); input.routeRequest.maxCapabilities = 1;
    expect(ids((await new CapabilityDiscoverer(config).discover(input))[0]!)).toEqual([entries[24]!.manifest.id]);
  });

  it("checks cancellation/deadlines before and after ranking and reports complete zero provider usage", async () => {
    const controller = new AbortController(); controller.abort();
    const rank = vi.fn(() => []);
    const engine = new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank } });
    for (const patch of [{ signal: controller.signal }, { deadlineAt: Date.now() - 1 }]) {
      const [result] = await engine.discover(request([alpha()], ["ticket"], patch));
      expect(result?.status).toBe("cancelled"); expect(result?.candidates).toEqual([]);
    }
    expect(rank).not.toHaveBeenCalled();
    const during = new AbortController();
    const aborting = new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank: ({ documents }) => {
      during.abort(); return documents.map((document) => ({
        capabilityId: document.capabilityId, scores: { lexical: 1, aliasPhrase: 0, semantic: null, final: 1 }
      }));
    } } });
    expect((await aborting.discover(request([alpha()], ["ticket"], { signal: during.signal })))[0]?.status).toBe("cancelled");
    const [normal] = await discover([alpha()]);
    expect(normal?.usage.stages).toEqual([]);
    expect(normal?.usage.totals).toMatchObject({ providerAttempts: 0, completedResponses: 0, retryAttempts: 0, repairAttempts: 0 });
    for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens", "estimatedCost"] as const) {
      expect(normal?.usage.totals[key]).toEqual({ total: 0, knownSubtotal: 0, complete: true });
    }
    expect(normal?.usage.totals.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("makes no network or budget calls, even when those host facilities are supplied", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
    const budget = { reserve: vi.fn(), settle: vi.fn() };
    try {
      await new CapabilityDiscoverer(config).discover(request([alpha()], ["ticket"], { budget }));
      expect(network).not.toHaveBeenCalled(); expect(budget.reserve).not.toHaveBeenCalled(); expect(budget.settle).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it("honors permission overrides, status, risk, domains and types via shared eligibility", async () => {
    const a = alpha();
    for (const patch of [
      { includeCapabilityIds: [] }, { excludeCapabilityIds: [a.manifest.id] }, { allowedDomains: ["other"] },
      { allowedCapabilityTypes: ["compute"] },
      { capabilityPermissions: { [a.manifest.id]: { allowed: false, permissions: [] } } }
    ]) {
      const input = request([a]); Object.assign(input.routeRequest, patch);
      expect((await new CapabilityDiscoverer(config).discover(input))[0]?.candidates).toEqual([]);
    }
    for (const status of ["disabled", "draft", "deprecated", "experimental"] as const) {
      expect((await discover([capability(a.manifest.id, { status })]))[0]?.candidates).toEqual([]);
    }
    const risk = request([capability(a.manifest.id, { risk_tier: "medium" })]);
    risk.routeRequest.maxRiskTier = "low";
    expect((await new CapabilityDiscoverer(config).discover(risk))[0]?.candidates).toEqual([]);
    const input = request([a]); input.routeRequest.builtContext.runtimeContext.subject.permissions = [];
    input.routeRequest.capabilityPermissions = { [a.manifest.id]: { allowed: true, permissions: ["ticket.read"] } };
    expect((await new CapabilityDiscoverer(config).discover(input))[0]?.status).toBe("matched");
  });
});

describe("custom rankers remain inside framework ownership", () => {
  const score = { lexical: 0.7, aliasPhrase: 0, semantic: null, final: 0.7 };
  it.each([
    () => [{ capabilityId: "support.ticket.foreign", scores: score }],
    ({ documents }: Parameters<CapabilityLexicalRanker["rank"]>[0]) => [
      { capabilityId: documents[0]!.capabilityId, scores: score }, { capabilityId: documents[0]!.capabilityId, scores: score }
    ],
    () => null, () => ({ candidates: [] }), () => Promise.reject(new Error("private exception")),
    () => { throw new Error("private exception"); },
    ...[NaN, Infinity, -1, 1.01, "1"].map((value) => ({ documents }: Parameters<CapabilityLexicalRanker["rank"]>[0]) => [
      { capabilityId: documents[0]!.capabilityId, scores: { ...score, final: value } }
    ]),
    ...[{ semantic: 0 }, { lexical: NaN }, { aliasPhrase: 2 }, { aliasPhrase: 1 }, { extra: 0 }].map((patch) =>
      ({ documents }: Parameters<CapabilityLexicalRanker["rank"]>[0]) => [
        { capabilityId: documents[0]!.capabilityId, scores: { ...score, ...patch } }
      ])
  ])("bounds invalid output without exception contents or fallback %#", async (rank) => {
    const engine = new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank } as CapabilityLexicalRanker });
    const [result] = await engine.discover(request([alpha()]));
    expect(result).toMatchObject({ status: "unavailable", candidates: [], diagnostics: [{ code: "invalid_ranker_output" }] });
    expect(JSON.stringify(result)).not.toContain("private exception");
  });

  it("only exposes immutable eligible retrieval documents, query and resolved configuration", async () => {
    const a = alpha(), b = capability("support.ticket.beta");
    const input = request([a, b]); input.routeRequest.excludeCapabilityIds = [b.manifest.id];
    const rank = vi.fn(({ documents, query, configuration }) => {
      expect(Object.keys(documents[0]).sort()).toEqual([
        "aliases", "capabilityId", "capabilityVersion", "documentHash", "name", "riskTier", "summary", "text", "tokens"
      ]);
      expect(documents.map((document: { capabilityId: string }) => document.capabilityId)).toEqual([a.manifest.id]);
      expect(Object.isFrozen(documents)).toBe(true); expect(Object.isFrozen(query.fragments[0])).toBe(true);
      expect(Object.isFrozen(configuration.limits)).toBe(true);
      return [{ capabilityId: b.manifest.id, scores: score }];
    });
    const [result] = await new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank } }).discover(input);
    expect(Object.keys(rank.mock.calls[0]![0]).sort()).toEqual(["configuration", "documents", "query"]);
    expect(result?.status).toBe("unavailable");
  });

  it("owns version, rank, admission, precision, tie order and limits despite hook order", async () => {
    const a = alpha(), b = capability("support.ticket.beta");
    const engine = new CapabilityDiscoverer({ ...config, limits: { maxCandidates: 1 } }, { ranker: {
      version: "host.v1", rank: ({ documents }) => [...documents].reverse().map((document) => ({
        capabilityId: document.capabilityId,
        scores: { ...score, final: document.capabilityId === b.manifest.id ? 0.70000000001 : 0.7 }
      }))
    } });
    const [result] = await engine.discover(request([a, b]));
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]).toMatchObject({ capabilityId: b.manifest.id, capabilityVersion: b.manifest.version, rank: 1 });
    const other = await new CapabilityDiscoverer(config, { ranker: { version: "host.v2", rank: () => [] } }).discover(request([a]));
    expect(other[0]?.retrievalPolicyFingerprint).not.toBe(result?.retrievalPolicyFingerprint);
  });

  it.each(["permissions", "registry", "metadata"])("discards stale results when the hook changes %s", async (kind) => {
    const a = alpha(), input = request([a]);
    const engine = new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank: () => {
      if (kind === "permissions") input.routeRequest.builtContext.runtimeContext.subject.permissions = [];
      if (kind === "registry") input.routeRequest.registry.capabilities = [];
      if (kind === "metadata") a.manifest.summary = "Changed after ranking.";
      return [{ capabilityId: a.manifest.id, scores: score }];
    } } });
    expect((await engine.discover(input))[0]).toMatchObject({
      status: "unavailable", candidates: [], diagnostics: [{ code: "stale_binding" }]
    });
  });

  it("binds fresh corpus and eligibility on every invocation", async () => {
    const a = alpha(), input = request([a]);
    const engine = new CapabilityDiscoverer(config);
    const [before] = await engine.discover(input);
    a.manifest.extensions = { discovery: { schema_version: "1.0", aliases: ["case lookup"] } };
    const [changed] = await engine.discover(input);
    expect(changed?.corpusFingerprint).not.toBe(before?.corpusFingerprint);
    input.routeRequest.builtContext.runtimeContext.subject.permissions = [];
    const [denied] = await engine.discover(input);
    expect(denied?.status).toBe("no_match");
    expect(denied?.eligibilityFingerprint).not.toBe(changed?.eligibilityFingerprint);
  });

  it("preserves independent query results when one hook call fails", async () => {
    const engine = new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank: ({ query, documents }) => {
      if (query.id === "task_0") throw new Error("private");
      return documents.map((document) => ({ capabilityId: document.capabilityId, scores: score }));
    } } });
    const results = await engine.discover(request([alpha()], ["ticket", "ticket"]));
    expect(results.map((result) => result.status)).toEqual(["unavailable", "matched"]);
    expect(results[1]?.candidates[0]?.capabilityId).toBe("support.ticket.alpha");
  });

  it("checks deadlines again after a synchronous hook completes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(100);
    try {
      const engine = new CapabilityDiscoverer(config, { ranker: { version: "test.v1", rank: ({ documents }) => {
        clock.mockReturnValue(201);
        return documents.map((document) => ({ capabilityId: document.capabilityId, scores: score }));
      } } });
      const [result] = await engine.discover(request([alpha()], ["ticket"], { deadlineAt: 200 }));
      expect(result).toMatchObject({ status: "cancelled", candidates: [], diagnostics: [{ code: "deadline_exceeded" }] });
    } finally { clock.mockRestore(); }
  });
});
