import type { CapabilityDiscoverySnapshot } from "../generated/manifest-types.js";
import type { CapabilityRouteRequest } from "../runtime/types.js";
import type { ReplayProviderRunner, ReplayStepResult } from "../replay/types.js";
import { validateDiscoverySnapshotStructure } from "../replay/discovery-snapshot.js";
import { captureEligibility } from "./bindings.js";
import { lexicalConfiguration, resolveDiscoveryConfiguration } from "./configuration.js";
import { buildCapabilitySearchCorpus } from "./corpus.js";
import { validateQueries } from "./discoverer.js";
import { DiscoveryError } from "./diagnostics.js";
import { fingerprintDiscoveryValue, hashDiscoveryContent } from "./fingerprint.js";
import { validateCapabilityEmbeddingIndex } from "./index-validation.js";
import { deepFreeze } from "./json-snapshot.js";
import { LEXICAL_RANKER_VERSION, LEXICAL_TOKENIZER_VERSION, rankLexically, tokenizeDiscoveryText } from "./lexical.js";
import { rankHybridCandidates, shortlistCandidates, validateLexicalCandidates } from "./ranking.js";
import { retrievalPolicyFingerprint } from "./retrieval-policy.js";
import type {
  CapabilityDiscoveryResult, CapabilityLexicalRanker, CapabilitySelectionBatchResult, DiscoveryConfiguration,
  DiscoveryQuery, EmbeddingConfiguration, RankedCapabilityCandidate
} from "./types.js";
import type { EmbeddingIndexLimits } from "./embedding-types.js";
import { validVectorBatch } from "./vectors.js";

export interface DiscoverySnapshotInput {
  routeRequest: CapabilityRouteRequest;
  configuration: DiscoveryConfiguration;
  queries: readonly DiscoveryQuery[];
  discovery: readonly CapabilityDiscoveryResult[];
  selection?: CapabilitySelectionBatchResult;
  ranker?: CapabilityLexicalRanker;
}
export interface DiscoveryReplayFixtures {
  queries: readonly DiscoveryQuery[];
  ranker?: CapabilityLexicalRanker;
  index?: unknown;
  embedding?: EmbeddingConfiguration;
  mock?: boolean;
  indexLimits?: EmbeddingIndexLimits;
  queryVectors?: Readonly<Record<string, { queryHash: string; configurationFingerprint: string; vector: readonly number[] }>>;
}
export interface DiscoveryReplayResult {
  status: "passed" | "failed" | "refused";
  mode: "snapshot_validation" | "ranking";
  semanticCorrectnessTested: false;
  steps: readonly ReplayStepResult[];
}

export function createDiscoverySnapshot(input: DiscoverySnapshotInput): CapabilityDiscoverySnapshot {
  const corpus = buildCapabilitySearchCorpus(input.routeRequest.registry);
  const configuration = resolveDiscoveryConfiguration(input.configuration);
  const queries = validateQueries({ queries: input.queries }, configuration);
  if (queries.length !== input.discovery.length) throw invalid();
  const policy = retrievalPolicyFingerprint(configuration, input.ranker?.version);
  const payload = {
    schemaVersion: "1.0" as const, projectionVersion: corpus.projectionVersion, tokenizerVersion: LEXICAL_TOKENIZER_VERSION,
    rankerVersion: input.ranker ? "custom:" + input.ranker.version : LEXICAL_RANKER_VERSION,
    registrySourceFingerprint: corpus.registrySourceFingerprint, corpusFingerprint: corpus.corpusFingerprint,
    retrievalPolicyFingerprint: policy, configuration,
    tasks: input.discovery.map((result, index) => {
      const query = queries[index]!;
      if (query.id !== result.queryId || result.corpusFingerprint !== corpus.corpusFingerprint || result.retrievalPolicyFingerprint !== policy) throw invalid();
      const decision = input.selection?.outcomes.find(outcome => outcome.queryId === query.id);
      return { queryId: query.id, queryHash: queryHash(query), status: result.status, requestedMode: result.requestedMode,
        actualMode: result.actualMode, eligibilityFingerprint: result.eligibilityFingerprint,
        retrievalPolicyFingerprint: result.retrievalPolicyFingerprint,
        ...(result.indexFingerprint ? { indexFingerprint: result.indexFingerprint } : {}),
        ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
        reasonCodes: result.diagnostics.map(diagnostic => diagnostic.code), candidates: result.candidates.map(candidateProjection),
        ...(decision ? { selection: { status: decision.status, capabilityId: decision.capabilityId,
          ...(decision.status === "selected" ? { capabilityVersion: decision.capabilityVersion } : {}), reasonCode: decision.reasonCode,
          selectorFingerprint: decision.selectorFingerprint, inputBindingHash: decision.inputBindingHash } } : {}) };
    })
  };
  const result = { ...payload, snapshotFingerprint: snapshotHash(payload) };
  const validated = validateDiscoverySnapshot(result, input.routeRequest);
  if (!validated.valid) throw invalid();
  return validated.snapshot;
}

export function validateDiscoverySnapshot(value: unknown, routeRequest: CapabilityRouteRequest):
  { valid: true; snapshot: CapabilityDiscoverySnapshot } | { valid: false } {
  const shape = validateDiscoverySnapshotStructure(value);
  if (!shape.valid) return shape;
  try {
    const snapshot = shape.snapshot, { snapshotFingerprint, ...payload } = snapshot;
    if (snapshotHash(payload) !== snapshotFingerprint) return { valid: false };
    const corpus = buildCapabilitySearchCorpus(routeRequest.registry), eligibility = captureEligibility(routeRequest);
    const configuration = resolveDiscoveryConfiguration(snapshot.configuration as DiscoveryConfiguration);
    const custom = snapshot.rankerVersion.startsWith("custom:") ? snapshot.rankerVersion.slice(7) : undefined;
    const policy = retrievalPolicyFingerprint(configuration, custom);
    if (snapshot.registrySourceFingerprint !== corpus.registrySourceFingerprint || snapshot.corpusFingerprint !== corpus.corpusFingerprint
      || snapshot.projectionVersion !== corpus.projectionVersion || snapshot.tokenizerVersion !== LEXICAL_TOKENIZER_VERSION
      || !custom && snapshot.rankerVersion !== LEXICAL_RANKER_VERSION || snapshot.retrievalPolicyFingerprint !== policy) return { valid: false };
    const eligible = new Map(eligibility.eligible.map(item => [item.manifest.id, item.manifest.version]));
    const tasks = new Set<string>();
    for (const task of snapshot.tasks) {
      const ids = new Set<string>();
      if (tasks.has(task.queryId) || task.eligibilityFingerprint !== eligibility.fingerprint || task.retrievalPolicyFingerprint !== policy
        || task.requestedMode !== configuration.mode || task.candidates.length > configuration.limits.maxCandidates
        || task.status !== "matched" && task.candidates.length || task.status === "matched" && (!task.candidates.length || task.actualMode === null)
        || ["unavailable", "cancelled"].includes(task.status) && task.actualMode !== null
        || task.actualMode === "hybrid" && task.requestedMode !== "hybrid"
        || task.requestedMode === "hybrid" && task.actualMode === "lexical" && configuration.mode === "hybrid"
          && (configuration.failurePolicy !== "lexical_fallback" || !task.degradedReason)) return { valid: false };
      tasks.add(task.queryId);
      for (const [index, candidate] of task.candidates.entries()) {
        if (ids.has(candidate.capabilityId) || eligible.get(candidate.capabilityId) !== candidate.capabilityVersion
          || candidate.rank !== index + 1 || candidate.scores.final <= 0 || candidate.scores.final < configuration.minRetrievalScore
          || task.actualMode === "lexical" && candidate.scores.semantic !== null
          || task.actualMode === "hybrid" && (candidate.scores.semantic === null || !task.indexFingerprint)) return { valid: false };
        ids.add(candidate.capabilityId);
      }
      const selection = task.selection;
      if (selection?.status === "selected") {
        if (!selection.capabilityId || !ids.has(selection.capabilityId) || eligible.get(selection.capabilityId) !== selection.capabilityVersion
          || selection.reasonCode !== "supported_candidate") return { valid: false };
      } else if (selection && (selection.capabilityId !== null || selection.capabilityVersion !== undefined
        || selection.status === "abstained" && !["no_suitable_candidate", "ambiguous_request", "insufficient_context"].includes(selection.reasonCode))) return { valid: false };
    }
    return { valid: true, snapshot };
  } catch { return { valid: false }; }
}

export function replayDiscoverySnapshot(value: unknown, options: {
  mode: DiscoveryReplayResult["mode"]; routeRequest: CapabilityRouteRequest; fixtures?: DiscoveryReplayFixtures;
}): DiscoveryReplayResult {
  const steps: ReplayStepResult[] = [];
  const finish = (status: DiscoveryReplayResult["status"]): DiscoveryReplayResult => deepFreeze({ status, mode: options.mode,
    semanticCorrectnessTested: false, steps: [...steps, { name: "model_semantic_correctness", status: "skipped", message: "Stored decisions do not establish model semantic correctness." }] });
  const validated = validateDiscoverySnapshot(value, options.routeRequest);
  if (!validated.valid) { steps.push({ name: "discovery_snapshot", status: "failed", message: "Snapshot structure, membership or current bindings are incompatible." }); return finish("failed"); }
  steps.push({ name: "discovery_snapshot", status: "passed", message: "Snapshot structure, membership and supplied current bindings are valid." });
  if (options.mode === "snapshot_validation") {
    steps.push({ name: "discovery_ranking", status: "skipped", message: "Snapshot validation does not recompute ranking." }); return finish("passed");
  }
  const snapshot = validated.snapshot, fixtures = options.fixtures;
  try {
    if (!fixtures || snapshot.rankerVersion.startsWith("custom:") && "custom:" + fixtures.ranker?.version !== snapshot.rankerVersion) throw invalid();
    const configuration = resolveDiscoveryConfiguration(snapshot.configuration as DiscoveryConfiguration);
    const queries = validateQueries({ queries: fixtures.queries }, configuration);
    if (queries.length !== snapshot.tasks.length) throw invalid();
    const corpus = buildCapabilitySearchCorpus(options.routeRequest.registry), eligibility = captureEligibility(options.routeRequest);
    const allowed = new Set(eligibility.eligible.map(item => item.manifest.id));
    const documents = Object.freeze(corpus.documents.filter(document => allowed.has(document.capabilityId)));
    for (const [index, task] of snapshot.tasks.entries()) {
      const query = queries[index]!;
      if (query.id !== task.queryId || queryHash(query) !== task.queryHash || task.actualMode === null) throw invalid();
      const lexical = lexicalConfiguration(configuration);
      const output = () => fixtures.ranker ? fixtures.ranker.rank(Object.freeze({ query, documents, configuration: lexical })) : rankLexically({ query, documents, configuration: lexical });
      let candidates: RankedCapabilityCandidate[] = [];
      if (documents.length && query.fragments.some(fragment => tokenizeDiscoveryText(fragment.text).length)) {
        if (task.actualMode === "lexical") candidates = shortlistCandidates(output(), query, documents, lexical);
        else {
          if (configuration.mode !== "hybrid" || !fixtures.embedding || fixtures.mock === undefined || !fixtures.indexLimits) throw invalid();
          const artifact = validateCapabilityEmbeddingIndex(fixtures.index, { corpus, configuration: fixtures.embedding, mock: fixtures.mock, limits: fixtures.indexLimits });
          const vector = fixtures.queryVectors?.[query.id];
          if (!artifact.valid || artifact.index.indexFingerprint !== task.indexFingerprint || !vector || vector.queryHash !== task.queryHash
            || vector.configurationFingerprint !== fingerprintDiscoveryValue("embedding_configuration", fixtures.embedding)
            || !validVectorBatch([vector.vector], 1, artifact.index.vectorDimension)) throw invalid();
          candidates = rankHybridCandidates(validateLexicalCandidates(output(), query, documents, true), vector.vector,
            new Map(artifact.index.entries.map(entry => [entry.capabilityId, entry.vector])), documents, configuration);
        }
      }
      const same = hashDiscoveryContent(candidates.map(candidateProjection)) === hashDiscoveryContent(task.candidates)
        && (candidates.length ? "matched" : "no_match") === task.status;
      steps.push({ name: "discovery_ranking:" + task.queryId, status: same ? "passed" : "failed", message: same ? "Task ranking matched the recorded candidates and scores." : "Task ranking differs from the recorded candidates or scores." });
    }
    return finish(steps.some(step => step.status === "failed") ? "failed" : "passed");
  } catch {
    steps.push({ name: "discovery_ranking", status: "skipped", message: "Compatible authorized query, ranker or vector fixtures were not supplied." });
    return finish("refused");
  }
}

export function createDiscoveryReplayHandler(options: { mode: DiscoveryReplayResult["mode"]; routeRequest: CapabilityRouteRequest; fixtures?: DiscoveryReplayFixtures }): ReplayProviderRunner {
  return trace => {
    const replay = replayDiscoverySnapshot(trace.extensions?.discovery, options);
    const steps = [...replay.steps];
    return { schemaVersion: "1.0", traceId: trace.traceId, mode: "router_only", status: replay.status, diagnostics: [], steps,
      extensions: { discoveryReplayMode: options.mode, semanticCorrectnessTested: false },
      summary: { total: steps.length, passed: steps.filter(step => step.status === "passed").length,
        failed: steps.filter(step => step.status === "failed").length, skipped: steps.filter(step => step.status === "skipped").length } };
  };
}
function candidateProjection(candidate: RankedCapabilityCandidate) {
  return { capabilityId: candidate.capabilityId, capabilityVersion: candidate.capabilityVersion, rank: candidate.rank,
    scores: { ...candidate.scores }, inclusionReason: candidate.inclusionReason, matchedAliasHashes: candidate.matchedAliases.map(alias => hashDiscoveryContent(alias)) };
}
function queryHash(query: DiscoveryQuery): string { return hashDiscoveryContent({ query }); }
function snapshotHash(payload: unknown): string { return hashDiscoveryContent({ kind: "discovery_snapshot", version: "1.0", payload }); }
function invalid(): DiscoveryError { return new DiscoveryError({ code: "replay_inputs_unavailable", message: "Discovery replay requires complete compatible bindings and authorized fixtures." }); }
