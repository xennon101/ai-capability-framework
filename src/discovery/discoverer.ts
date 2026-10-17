import { assertProviderRunScope } from "../runtime/provider-run.js";
import { retrievalPolicyFingerprint } from "./retrieval-policy.js";
import { performance } from "node:perf_hooks";
import { captureEligibility } from "./bindings.js";
import { hasOnlyKeys, isRecord, lexicalConfiguration, nonblank, resolveDiscoveryConfiguration } from "./configuration.js";
import { buildCapabilitySearchCorpus, registrySourceFingerprint } from "./corpus.js";
import { DiscoveryError, type DiscoveryDiagnosticCode } from "./diagnostics.js";
import {
  checkEmbeddingTexts, invalidEmbeddingConfiguration, resolveEmbeddingConfiguration, resolveEmbeddingExecution, resolveIndexLimits
} from "./embedding-configuration.js";
import type { HybridDiscoveryDependencies } from "./embedding-types.js";
import { runEmbeddingAttempt, stopReason, validateProviderInvocation } from "./embeddings.js";
import { validateCapabilityEmbeddingIndex } from "./index-validation.js";
import { boundedJsonSnapshot, deepFreeze } from "./json-snapshot.js";
import { rankLexically, tokenizeDiscoveryText } from "./lexical.js";
import { rankHybridCandidates, shortlistCandidates, validateLexicalCandidates } from "./ranking.js";
import type {
  CapabilityDiscoveryRequest, CapabilityDiscoveryResult, CapabilityLexicalRanker, DiscoveryConfiguration,
  DiscoveryQuery, DiscoveryUsage, ResolvedDiscoveryConfiguration
} from "./types.js";
import { aggregateDiscoveryUsage } from "./usage.js";

export { HYBRID_RANKER_VERSION, QUERY_EMBEDDING_PROJECTION_VERSION } from "./retrieval-policy.js";
export interface CapabilityDiscovererOptions {
  ranker?: CapabilityLexicalRanker;
  embedding?: HybridDiscoveryDependencies;
}

export class CapabilityDiscoverer {
  readonly configuration: ResolvedDiscoveryConfiguration;
  private readonly ranker?: CapabilityLexicalRanker;
  private readonly embedding?: HybridDiscoveryDependencies & {
    configuration: Readonly<import("./types.js").EmbeddingConfiguration>; mock: boolean
  };

  constructor(configuration: DiscoveryConfiguration, options: CapabilityDiscovererOptions = {}) {
    this.configuration = resolveDiscoveryConfiguration(configuration);
    if (!isRecord(options as unknown) || !hasOnlyKeys(options as unknown as Record<string, unknown>, ["ranker", "embedding"])
      || (options.ranker !== undefined && (!options.ranker || !nonblank(options.ranker.version) || typeof options.ranker.rank !== "function"))) {
      throw new DiscoveryError({ code: "invalid_configuration", message: "A custom ranker requires a version and synchronous rank function." });
    }
    if (options.ranker) this.ranker = Object.freeze({
      version: options.ranker.version, rank: options.ranker.rank.bind(options.ranker)
    });
    if (this.configuration.mode === "hybrid") {
      const embedding = options.embedding;
      if (!embedding || !isRecord(embedding as unknown) || !hasOnlyKeys(embedding as unknown as Record<string, unknown>, ["client", "index", "indexLimits", "execution"])
        || !embedding.client || typeof embedding.client.mock !== "boolean" || typeof embedding.client.embed !== "function") throw invalidEmbeddingConfiguration();
      const indexLimits = resolveIndexLimits(embedding.indexLimits);
      let index: unknown = null;
      try { index = deepFreeze(boundedJsonSnapshot(embedding.index, indexLimits.maxArtifactBytes)); }
      catch { /* Invalid artifacts yield per-query unavailable/fallback outcomes before any provider purchase. */ }
      this.embedding = Object.freeze({
        client: embedding.client, index, indexLimits, execution: resolveEmbeddingExecution(embedding.execution),
        configuration: resolveEmbeddingConfiguration(embedding.client.configuration), mock: embedding.client.mock
      });
    } else if (options.embedding !== undefined) {
      throw new DiscoveryError({ code: "invalid_configuration", message: "Lexical discovery does not accept embedding dependencies." });
    }
  }

  async discover(request: CapabilityDiscoveryRequest): Promise<readonly CapabilityDiscoveryResult[]> {
    if (request.providerRun) {
      const run = request.providerRun;
      assertProviderRunScope(run, request.runId, request.budget ? { ledger: request.budget, policy: run.budget.policy } : undefined);
      const signals = [request.signal, run.signal].filter((item): item is AbortSignal => !!item);
      request = { ...request, budget: request.budget ?? run.budget.ledger, signal: signals.length ? AbortSignal.any(signals) : undefined,
        deadlineAt: Math.min(request.deadlineAt ?? Infinity, run.deadlineAt) };
    }
    const configuration = this.invocationConfiguration(request);
    const queries = validateQueries(request, configuration);
    if (!queries.length) return [];
    const started = performance.now();
    const corpus = buildCapabilitySearchCorpus(request.routeRequest.registry);
    const eligibility = captureEligibility(request.routeRequest);
    const eligibleIds = new Set(eligibility.eligible.map(({ manifest }) => manifest.id));
    const documents = Object.freeze(corpus.documents.filter(document => eligibleIds.has(document.capabilityId)));
    const lexical = lexicalConfiguration(configuration);
    const policy = retrievalPolicyFingerprint(configuration, this.ranker?.version);
    const current = () => {
      try {
        return captureEligibility(request.routeRequest).fingerprint === eligibility.fingerprint
          && registrySourceFingerprint(request.routeRequest.registry) === corpus.registrySourceFingerprint;
      } catch { return false; }
    };
    const result = (
      queryId: string, status: CapabilityDiscoveryResult["status"], code?: DiscoveryDiagnosticCode,
      usage = zeroDiscoveryUsage(performance.now() - started)
    ): CapabilityDiscoveryResult => ({
      queryId, status, requestedMode: configuration.mode, actualMode: status === "cancelled" || status === "unavailable" ? null : configuration.mode,
      candidates: [], corpusFingerprint: corpus.corpusFingerprint, eligibilityFingerprint: eligibility.fingerprint,
      retrievalPolicyFingerprint: policy, policyVersion: configuration.policyVersion, usage,
      diagnostics: code ? [{ code, queryId, message: diagnosticMessage(code) }] : []
    });
    const lexicalOutput = (query: DiscoveryQuery) => {
      const input = Object.freeze({ query, documents, configuration: lexical });
      return this.ranker ? this.ranker.rank(input) : rankLexically(input);
    };
    const lexicalResult = (query: DiscoveryQuery, usage?: DiscoveryUsage, degradation?: DiscoveryDiagnosticCode): CapabilityDiscoveryResult => {
      try {
        const candidates = shortlistCandidates(lexicalOutput(query), query, documents, lexical);
        return {
          ...result(query.id, candidates.length ? "matched" : "no_match", candidates.length ? undefined : "no_matching_candidates", usage),
          actualMode: "lexical", candidates,
          ...(degradation ? { degradedReason: degradation, diagnostics: [
            { code: degradation, queryId: query.id, message: diagnosticMessage(degradation) },
            { code: "lexical_fallback" as const, queryId: query.id, message: "The whole query used the explicit lexical fallback policy." }
          ] } : {})
        };
      } catch { return result(query.id, "unavailable", "invalid_ranker_output", usage); }
    };
    const semanticFailure = (query: DiscoveryQuery, code: DiscoveryDiagnosticCode, usage?: DiscoveryUsage): CapabilityDiscoveryResult => {
      if (configuration.mode === "hybrid" && configuration.failurePolicy === "lexical_fallback"
        && ["invalid_index", "embedding_configuration_mismatch", "invalid_embedding", "provider_unavailable"].includes(code)) {
        if (!current()) return result(query.id, "unavailable", "stale_binding", usage);
        return lexicalResult(query, usage, code);
      }
      return result(query.id, code === "cancelled" || code === "deadline_exceeded" ? "cancelled" : "unavailable", code, usage);
    };
    const hasWork = documents.length && queries.some(query => query.fragments.some(fragment => tokenizeDiscoveryText(fragment.text).length));
    const embedding = this.embedding;
    const index = embedding && hasWork ? validateCapabilityEmbeddingIndex(embedding.index, {
      corpus, configuration: embedding.configuration, mock: embedding.mock, limits: embedding.indexLimits
    }) : undefined;
    if (embedding && index?.valid && !discoveryStopReason(request)) {
      validateProviderInvocation(request);
      for (const query of queries) {
        if (query.fragments.some(fragment => tokenizeDiscoveryText(fragment.text).length)) {
          checkEmbeddingTexts([query.fragments.map(fragment => fragment.text).join("\n")], embedding.execution.limits);
        }
      }
    }
    const results: CapabilityDiscoveryResult[] = [];
    for (const query of queries) {
      const stopped = discoveryStopReason(request);
      if (stopped) { results.push(result(query.id, "cancelled", stopped)); continue; }
      if (!query.fragments.some(fragment => tokenizeDiscoveryText(fragment.text).length)) {
        results.push(result(query.id, "no_match", "empty_query")); continue;
      }
      if (!documents.length) { results.push(result(query.id, "no_match", "no_eligible_capabilities")); continue; }
      if (!current()) { results.push(result(query.id, "unavailable", "stale_binding")); continue; }
      if (configuration.mode === "lexical") { results.push(lexicalResult(query)); continue; }
      if (!index?.valid) {
        results.push(semanticFailure(query, index?.diagnostics[0]?.code ?? "invalid_index")); continue;
      }
      let candidates;
      try { candidates = validateLexicalCandidates(lexicalOutput(query), query, documents, true); }
      catch { results.push(result(query.id, "unavailable", "invalid_ranker_output")); continue; }
      if (!candidates.length) { results.push(result(query.id, "no_match", "no_matching_candidates")); continue; }
      const attempted = await runEmbeddingAttempt({
        ...request, deadlineAt: request.deadlineAt!, budget: request.budget!, client: embedding!.client,
        configuration: embedding!.configuration, mock: embedding!.mock, execution: embedding!.execution,
        texts: [query.fragments.map(fragment => fragment.text).join("\n")], stage: "query_embedding",
        maxVectorDimension: embedding!.indexLimits.maxVectorDimension, expectedDimension: index.index.vectorDimension,
        controls: request.routeRequest.controls, runtimeContext: request.routeRequest.builtContext.runtimeContext, isCurrent: current
      });
      if (attempted.status !== "completed") {
        results.push(semanticFailure(query, attempted.diagnostics[0]!.code, attempted.usage)); continue;
      }
      const vectors = new Map(index.index.entries.map(entry => [entry.capabilityId, entry.vector]));
      const selected = rankHybridCandidates(candidates, attempted.vectors[0]!, vectors, documents, configuration);
      results.push({
        ...result(query.id, selected.length ? "matched" : "no_match", selected.length ? undefined : "no_matching_candidates", attempted.usage),
        candidates: selected, indexFingerprint: index.index.indexFingerprint
      });
    }
    const valid = current();
    return results.map(entry => {
      const stopped = discoveryStopReason(request);
      if (stopped || !valid && entry.status === "matched") {
        const { indexFingerprint: _, ...retained } = entry;
        const code = stopped ?? "stale_binding";
        return { ...retained, status: stopped ? "cancelled" as const : "unavailable" as const, actualMode: null, candidates: [],
          diagnostics: [{ code, queryId: entry.queryId, message: diagnosticMessage(code) }] };
      }
      return entry;
    });
  }

  private invocationConfiguration(request: CapabilityDiscoveryRequest): ResolvedDiscoveryConfiguration {
    if (!isRecord(request) || !nonblank(request.runId) || !nonblank(request.requestId)
      || (request.deadlineAt !== undefined && (typeof request.deadlineAt !== "number" || !Number.isFinite(request.deadlineAt)))
      || (request.signal !== undefined && !(request.signal instanceof AbortSignal))) {
      throw new DiscoveryError({ code: "invalid_input", message: "Discovery requires invocation identifiers and valid cancellation bounds." });
    }
    const limit = request.maxCandidates === undefined ? this.configuration.limits.maxCandidates : request.maxCandidates;
    if (!Number.isInteger(limit) || limit < 1 || limit > this.configuration.limits.maxCandidates) {
      throw new DiscoveryError({ code: "invalid_input", message: "The invocation candidate limit must lower or equal the configured limit." });
    }
    return Object.freeze({ ...this.configuration, limits: Object.freeze({
      ...this.configuration.limits, maxCandidates: limit, aliasDiversitySlots: limit === 1 ? 0 : this.configuration.limits.aliasDiversitySlots
    }) });
  }
}

export function validateQueries(request: Pick<CapabilityDiscoveryRequest, "queries">, configuration: ResolvedDiscoveryConfiguration): readonly DiscoveryQuery[] {
  const invalid = () => new DiscoveryError({ code: "invalid_input", message: "Discovery requires unique query IDs and string fragments." });
  const exceeded = () => new DiscoveryError({ code: "input_limit_exceeded", message: "Discovery input exceeds the configured batch, fragment, or text limit." });
  if (!Array.isArray(request.queries)) throw invalid();
  if (request.queries.length > configuration.limits.maxQueries) throw exceeded();
  const ids = new Set<string>();
  return Object.freeze(Array.from(request.queries, query => {
    if (!isRecord(query) || !hasOnlyKeys(query, ["id", "fragments"]) || !nonblank(query.id)
      || ids.has(query.id) || !Array.isArray(query.fragments)) throw invalid();
    ids.add(query.id);
    if (query.fragments.length > configuration.limits.maxFragmentsPerQuery) throw exceeded();
    let characters = 0;
    const fragments = Array.from(query.fragments, fragment => {
      if (!isRecord(fragment) || !hasOnlyKeys(fragment, ["key", "text"])
        || !nonblank(fragment.key) || typeof fragment.text !== "string") throw invalid();
      characters += fragment.text.length;
      if (characters > configuration.limits.maxQueryCharacters) throw exceeded();
      return Object.freeze({ key: fragment.key, text: fragment.text });
    });
    return Object.freeze({ id: query.id, fragments: Object.freeze(fragments) });
  }));
}

export function discoveryStopReason(request: { signal?: AbortSignal; deadlineAt?: number }): DiscoveryDiagnosticCode | undefined {
  return stopReason(request);
}

export function zeroDiscoveryUsage(elapsedMs: number): DiscoveryUsage {
  return aggregateDiscoveryUsage([], elapsedMs);
}

function diagnosticMessage(code: DiscoveryDiagnosticCode): string {
  switch (code) {
    case "cancelled": return "Discovery was cancelled.";
    case "deadline_exceeded": return "The discovery deadline elapsed.";
    case "empty_query": return "The query has no searchable tokens.";
    case "no_eligible_capabilities": return "No capabilities are currently eligible.";
    case "no_matching_candidates": return "No eligible candidates met the retrieval policy.";
    case "stale_binding": return "Discovery bindings changed before candidates could be returned.";
    case "invalid_index": return "The embedding index is invalid or stale.";
    case "embedding_configuration_mismatch": return "Embedding configurations or dimensions were incompatible.";
    case "invalid_embedding": return "The embedding client returned invalid semantic inputs.";
    case "provider_unavailable": return "The embedding provider was unavailable.";
    case "budget_denied": return "The shared embedding budget denied this attempt.";
    case "control_denied": return "Runtime controls denied the embedding attempt.";
    case "accounting_unavailable": return "Embedding reservation or settlement accounting was unavailable.";
    default: return "The lexical ranker was unavailable or returned invalid output.";
  }
}
