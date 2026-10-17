import type { DiscoveryEvaluationObservations, DiscoveryEvaluationSuite } from "../generated/manifest-types.js";
import { buildRegistry } from "../registry.js";
import { validateRuntimeContext } from "../runtime/context.js";
import { deepFreeze } from "../runtime/bounded-json.js";
import type { AicfRuntimeContext, CapabilityRouteRequest } from "../runtime/types.js";
import type { ProviderStageUsage, ProviderUsage } from "../runtime/provider-types.js";
import { aggregateProviderUsage, usageQuantities, USAGE_QUANTITIES } from "../runtime/provider-usage.js";
import type { CapabilityManifest, LoadedCapabilityManifest, ManifestRegistry } from "../types.js";
import { validateManifests } from "../validator.js";
import { captureEligibility } from "./bindings.js";
import { buildCapabilitySearchCorpus, registrySourceFingerprint } from "./corpus.js";
import { resolveDiscoveryConfiguration } from "./configuration.js";
import { DiscoveryError } from "./diagnostics.js";
import { hashDiscoveryContent } from "./fingerprint.js";
import { evaluationObservationsSnapshot, evaluationSuiteSnapshot } from "./evaluation-validation.js";
import type { DiscoveryEvaluationDiagnostic } from "./evaluation-validation.js";
import { retrievalPolicyFingerprint } from "./retrieval-policy.js";
import type { DiscoveryConfiguration } from "./types.js";

export type { DiscoveryEvaluationSuite, DiscoveryEvaluationObservations } from "../generated/manifest-types.js";
export type { DiscoveryEvaluationDiagnostic } from "./evaluation-validation.js";
export interface DiscoveryEvaluationRate { numerator: number; denominator: number; value: number | null; }
export interface DiscoveryEvaluationDistribution { count: number; minimum: number | null; mean: number | null; p95: number | null; maximum: number | null; }
export interface DiscoveryEvaluationReport {
  suiteFingerprint: string;
  scopeFingerprint: string;
  complete: boolean;
  semanticQualityQualified: false;
  counts: { expected: number; observed: number; missing: number; byPartition: Record<string, number>; byDomain: Record<string, number>; byCohort: Record<string, number>; };
  retrieval: {
    k: number; compatibleRecallAtK: DiscoveryEvaluationRate; topOnePrecision: DiscoveryEvaluationRate;
    noMatchFalsePositiveRate: DiscoveryEvaluationRate; shortlistSize: DiscoveryEvaluationDistribution;
    outcomes: Record<string, number>; forbiddenCandidateCases: number; policyViolationCases: number; readToMutationCases: number;
  };
  selection: {
    outcomes: Record<string, number>; compatibleAccuracy: DiscoveryEvaluationRate; abstentionRate: DiscoveryEvaluationRate;
    coverage: DiscoveryEvaluationRate; noMatchFalseSelectionRate: DiscoveryEvaluationRate;
    forbiddenChoices: number; policyViolations: number; readToMutationChoices: number;
  };
  latencyMs: DiscoveryEvaluationDistribution;
  accountingComplete: boolean;
  usageComplete: boolean;
  usage: ProviderUsage;
  provenance: { mockAttempts: number; liveAttempts: number; pendingAttempts: number; };
}
export type DiscoveryEvaluationResult =
  | { valid: true; report: Readonly<DiscoveryEvaluationReport>; diagnostics: readonly [] }
  | { valid: false; diagnostics: readonly DiscoveryEvaluationDiagnostic[] };
export interface EvaluateCapabilityDiscoveryRequest {
  suite: unknown;
  registry: ManifestRegistry;
  observations: unknown;
  /** Explicit expected cases; omitted means the entire frozen suite. Missing observations remain missing. */
  caseIds?: readonly string[];
}

/** Includes authored cases, labels, partitions and capability content; excludes no suite fields. */
export function fingerprintDiscoveryEvaluationSuite(value: DiscoveryEvaluationSuite): string {
  const suite = evaluationSuiteSnapshot(value);
  if (!suite) throw new DiscoveryError({ code: "invalid_input", message: "A valid discovery evaluation suite is required." });
  return hashDiscoveryContent({ kind: "discovery_evaluation_suite", version: "1.0", suite });
}

function loadedSuite(suite: DiscoveryEvaluationSuite): LoadedCapabilityManifest[] {
  return suite.capabilities.map(manifest => ({ kind: "capability", path: `synthetic/${manifest.id}.yaml`,
    absolutePath: `/synthetic/${manifest.id}.yaml`, manifest: manifest as CapabilityManifest }));
}

function routeFor(suite: DiscoveryEvaluationSuite, entry: DiscoveryEvaluationSuite["cases"][number], registry: ManifestRegistry): CapabilityRouteRequest {
  const context = suite.contexts[entry.context_id]!;
  const runtimeContext = context.runtime_context as AicfRuntimeContext;
  validateRuntimeContext(runtimeContext);
  if (!Array.isArray(runtimeContext.subject.permissions) || !runtimeContext.subject.permissions.every(x => typeof x === "string")
    || !runtimeContext.autonomy || !["low", "medium", "high", "critical"].includes(runtimeContext.autonomy.maxRiskTier)) throw new Error("context");
  return { ...context.eligibility, registry, userInput: { text: entry.fragments.map(fragment => fragment.text).join("\n") },
    builtContext: { runtimeContext, items: [], modelContextText: "", redactions: [], warnings: [] } } as CapabilityRouteRequest;
}

/** Semantic fixture checks used by the CLI without executing retrieval or providers. */
export function validateDiscoveryEvaluationSuite(value: unknown, registry?: ManifestRegistry): readonly DiscoveryEvaluationDiagnostic[] {
  const suite = evaluationSuiteSnapshot(value);
  if (!suite) return [{ code: "invalid_suite_schema" }];
  const errors: DiscoveryEvaluationDiagnostic[] = [];
  const add = (code: string, caseId?: string) => { if (errors.length < 64) errors.push({ code, ...(caseId ? { caseId } : {}) }); };
  try {
    const definitions = loadedSuite(suite);
    if (!validateManifests(definitions).valid) return [{ code: "invalid_suite_capabilities" }];
    const authoredRegistry = buildRegistry(definitions);
    if (registry && registrySourceFingerprint(registry) !== registrySourceFingerprint(authoredRegistry)) return [{ code: "suite_registry_mismatch" }];
    registry ??= authoredRegistry;
    for (const context of Object.values(suite.contexts)) {
      try { validateRuntimeContext(context.runtime_context); }
      catch { add("invalid_context"); }
      for (const id of [...context.eligibility?.includeCapabilityIds ?? [], ...context.eligibility?.excludeCapabilityIds ?? []]) {
        if (!registry.capabilityById.has(id)) add("unknown_eligibility_capability");
      }
    }
    const ids = new Set<string>(), families = new Map<string, string>();
    for (const entry of suite.cases) {
      if (ids.has(entry.id)) add("duplicate_case", entry.id);
      ids.add(entry.id);
      if (families.has(entry.family_id) && families.get(entry.family_id) !== entry.partition) add("family_partition_leak", entry.id);
      families.set(entry.family_id, entry.partition);
      if (!Object.hasOwn(suite.contexts, entry.context_id)) { add("unknown_context", entry.id); continue; }
      if (entry.compatible_ids.some(id => entry.forbidden_ids.includes(id))
        || entry.compatible_ids.length && entry.forbidden_operations.includes(entry.expected_operation)
        || entry.cohorts.includes("true_no_match") && entry.compatible_ids.length) add("contradictory_labels", entry.id);
      let eligible: Set<string>;
      try { eligible = new Set(captureEligibility(routeFor(suite, entry, registry)).eligible.map(x => x.manifest.id)); }
      catch { add("invalid_context", entry.id); continue; }
      for (const id of [...entry.compatible_ids, ...entry.forbidden_ids]) {
        const capability = registry.capabilityById.get(id)?.manifest;
        if (!capability) { add("unknown_capability", entry.id); continue; }
        if (entry.compatible_ids.includes(id) && (!eligible.has(id) || operationFor(capability) !== entry.expected_operation
          || capability.lifecycle.commit || capability.capability_type === "write_commit")) add("invalid_compatible_capability", entry.id);
      }
    }
  } catch { add("invalid_suite_bindings"); }
  return errors;
}

const operationFor = (capability: CapabilityManifest): "read" | "prepare" | "commit" => capability.lifecycle.commit
  || capability.capability_type === "write_commit" ? "commit" : capability.lifecycle.prepare ? "prepare" : "read";
const rate = (numerator: number, denominator: number): DiscoveryEvaluationRate => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
function distribution(values: number[]): DiscoveryEvaluationDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  let mean = 0;
  values.forEach((value, index) => { mean += (value - mean) / (index + 1); });
  return { count: values.length, minimum: sorted[0] ?? null, maximum: sorted.at(-1) ?? null,
    mean: values.length ? mean : null,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null };
}

/** Scores observations only. It never calls a ranker, model, embedding client, or executor. */
export function evaluateCapabilityDiscovery(request: EvaluateCapabilityDiscoveryRequest): DiscoveryEvaluationResult {
  const errors = [...validateDiscoveryEvaluationSuite(request.suite, request.registry)];
  const suite = evaluationSuiteSnapshot(request.suite);
  const observations = evaluationObservationsSnapshot(request.observations);
  if (!observations) errors.push({ code: "invalid_observations_schema" });
  const caseIds = request.caseIds;
  if (caseIds !== undefined && (!Array.isArray(caseIds) || caseIds.length > (suite?.cases.length ?? 0) || !Array.from(caseIds).every(id => typeof id === "string")
    || new Set(caseIds).size !== caseIds.length || caseIds.some(id => !suite?.cases.some(entry => entry.id === id)))) {
    errors.push({ code: "invalid_evaluation_scope" });
  }
  if (errors.length || !suite || !observations) return { valid: false, diagnostics: deepFreeze(errors) };
  try { return evaluate(suite, observations, request.registry, caseIds); }
  catch { return { valid: false, diagnostics: [{ code: "invalid_evaluation_bindings" }] }; }
}

function evaluate(suite: DiscoveryEvaluationSuite, observations: DiscoveryEvaluationObservations, registry: ManifestRegistry, caseIds?: readonly string[]): DiscoveryEvaluationResult {
  const errors: DiscoveryEvaluationDiagnostic[] = [];
  const add = (code: string, caseId?: string) => { if (errors.length < 64) errors.push({ code, ...(caseId ? { caseId } : {}) }); };
  const configuration = resolveDiscoveryConfiguration(observations.configuration as DiscoveryConfiguration);
  if (hashDiscoveryContent(configuration) !== hashDiscoveryContent(observations.configuration)) add("unresolved_configuration");
  const corpus = buildCapabilitySearchCorpus(registry);
  const suiteFingerprint = fingerprintDiscoveryEvaluationSuite(suite);
  if (observations.suite_id !== suite.id || observations.suite_fingerprint !== suiteFingerprint
    || observations.registry_source_fingerprint !== corpus.registrySourceFingerprint || observations.corpus_fingerprint !== corpus.corpusFingerprint
    || observations.retrieval_policy_fingerprint !== retrievalPolicyFingerprint(configuration, observations.custom_ranker_version)) add("observation_binding_mismatch");
  const definitions = new Map(suite.cases.map(entry => [entry.id, entry]));
  const scope = new Set(caseIds ?? suite.cases.map(entry => entry.id));
  const expectedCases = suite.cases.filter(entry => scope.has(entry.id));
  const scopeFingerprint = hashDiscoveryContent({ kind: "discovery_evaluation_scope", version: "1.0", suiteFingerprint,
    caseIds: [...scope].sort() });
  const seen = new Set<string>();
  const retrievalOutcomes: Record<string, number> = { matched: 0, no_match: 0, unavailable: 0, cancelled: 0 };
  const selectionOutcomes: Record<string, number> = { selected: 0, abstained: 0, unavailable: 0, invalid_output: 0, cancelled: 0, not_performed: 0 };
  const byPartition: Record<string, number> = Object.create(null), byDomain: Record<string, number> = Object.create(null), byCohort: Record<string, number> = Object.create(null);
  let hits = 0, topHits = 0, nonempty = 0, noMatchFalsePositives = 0;
  let forbiddenCandidates = 0, policyCandidateCases = 0, readMutationCases = 0;
  let selectedMatched = 0, correctSelected = 0, covered = 0, answerableMatched = 0, submitted = 0;
  let forbiddenChoices = 0, policyChoices = 0, readMutationChoices = 0;
  let noMatchSelections = 0;
  const sizes: number[] = [], latencies: number[] = [];
  for (const observed of observations.cases) {
    const entry = definitions.get(observed.case_id);
    if (!entry) { add("foreign_observation", observed.case_id); continue; }
    if (!scope.has(entry.id)) { add("observation_outside_scope", entry.id); continue; }
    if (seen.has(entry.id)) { add("duplicate_observation", entry.id); continue; }
    seen.add(entry.id);
    const eligibility = captureEligibility(routeFor(suite, entry, registry));
    const eligible = new Set(eligibility.eligible.map(x => x.manifest.id));
    if (observed.eligibility_fingerprint !== eligibility.fingerprint) add("eligibility_binding_mismatch", entry.id);
    if ((observed.status === "matched") !== !!observed.candidates.length || observed.candidates.length > configuration.limits.maxCandidates
      || (observed.status === "unavailable" || observed.status === "cancelled") !== (observed.actual_mode === null)
      || configuration.mode === "lexical" && observed.actual_mode === "hybrid"
      || configuration.mode === "hybrid" && observed.actual_mode === "lexical" && configuration.failurePolicy !== "lexical_fallback"
      || observed.actual_mode === "hybrid" && observed.status === "matched" && !observed.index_fingerprint) add("invalid_retrieval_observation", entry.id);
    const candidateIds = new Set<string>();
    let forbidden = false, policy = false, readMutation = false;
    for (const candidate of observed.candidates) {
      const manifest = registry.capabilityById.get(candidate.capability_id)?.manifest;
      if (!manifest || manifest.version !== candidate.capability_version || candidateIds.has(candidate.capability_id)) {
        add("invalid_candidate_binding", entry.id); continue;
      }
      candidateIds.add(candidate.capability_id);
      const operation = operationFor(manifest);
      forbidden ||= entry.forbidden_ids.includes(manifest.id) || entry.forbidden_operations.includes(operation);
      policy ||= !eligible.has(manifest.id) || operation === "commit";
      readMutation ||= entry.expected_operation === "read" && operation !== "read";
    }
    if (forbidden) forbiddenCandidates++;
    if (policy) policyCandidateCases++;
    if (readMutation) readMutationCases++;
    retrievalOutcomes[observed.status]!++;
    if (observed.candidates.length) nonempty++;
    if (entry.compatible_ids.some(id => candidateIds.has(id))) hits++;
    if (observed.candidates[0] && entry.compatible_ids.includes(observed.candidates[0].capability_id)) topHits++;
    if (entry.cohorts.includes("true_no_match") && candidateIds.size) noMatchFalsePositives++;
    sizes.push(observed.candidates.length); latencies.push(observed.latency_ms);
    byPartition[entry.partition] = (byPartition[entry.partition] ?? 0) + 1;
    byDomain[entry.domain] = (byDomain[entry.domain] ?? 0) + 1;
    for (const cohort of entry.cohorts) byCohort[cohort] = (byCohort[cohort] ?? 0) + 1;
    const selection = observed.selection;
    const answerable = entry.compatible_ids.length > 0;
    if (answerable && observed.status === "matched") answerableMatched++;
    const status = selection?.status ?? "not_performed";
    selectionOutcomes[status]!++;
    if (status !== "not_performed") {
      submitted++;
      if (observed.status !== "matched") add("selection_without_shortlist", entry.id);
    }
    if (selection?.status === "selected") {
      const manifest = registry.capabilityById.get(selection.capability_id!)?.manifest;
      if (!manifest || !candidateIds.has(manifest.id) || manifest.version !== selection.capability_version
        || operationFor(manifest) !== selection.operation) { add("invalid_selection_binding", entry.id); continue; }
      if (answerable) { selectedMatched++; covered++; if (entry.compatible_ids.includes(manifest.id)) correctSelected++; }
      if (entry.cohorts.includes("true_no_match")) noMatchSelections++;
      if (entry.forbidden_ids.includes(manifest.id) || entry.forbidden_operations.includes(selection.operation!)) forbiddenChoices++;
      if (!eligible.has(manifest.id) || selection.operation === "commit") policyChoices++;
      if (entry.expected_operation === "read" && selection.operation !== "read") readMutationChoices++;
    }
  }
  const attempts = new Map<string, DiscoveryEvaluationObservations["attempts"][number]>();
  for (const attempt of observations.attempts) {
    const key = JSON.stringify([attempt.run_id, attempt.attempt_id]);
    const previous = attempts.get(key);
    if (previous && hashDiscoveryContent(previous) !== hashDiscoveryContent(attempt)) add("conflicting_attempt_receipt");
    attempts.set(key, attempt);
    if (attempt.completed_responses > attempt.provider_attempts || attempt.retry_attempts > attempt.provider_attempts
      || attempt.repair_attempts > attempt.provider_attempts) add("invalid_attempt_counts");
  }
  if (errors.length) return { valid: false, diagnostics: deepFreeze(errors) };
  const stages: ProviderStageUsage[] = [...attempts.values()].map(attempt => ({
    attemptId: JSON.stringify([attempt.run_id, attempt.attempt_id]), stage: attempt.stage, configuration: attempt.configuration,
    mock: attempt.mock, pending: attempt.pending, outcome: attempt.outcome, cacheHits: 0,
    providerAttempts: attempt.provider_attempts, completedResponses: attempt.completed_responses,
    retryAttempts: attempt.retry_attempts, repairAttempts: attempt.repair_attempts, elapsedMs: attempt.elapsed_ms,
    ...usageQuantities(attempt.usage, attempt.provider_attempts === 0)
  }));
  const elapsed = stages.reduce((sum, stage) => sum + stage.elapsedMs, 0);
  if (!Number.isFinite(elapsed)
    || (["providerAttempts", "completedResponses", "retryAttempts", "repairAttempts"] as const).some(key =>
      !Number.isSafeInteger(stages.reduce((sum, stage) => sum + stage[key], 0)))
    || USAGE_QUANTITIES.some(key => {
      const total = stages.reduce((sum, stage) => sum + stage[key].knownSubtotal, 0);
      return !Number.isFinite(total) || key !== "estimatedCost" && !Number.isSafeInteger(total);
    })) return { valid: false, diagnostics: [{ code: "invalid_accounting_totals" }] };
  let usage = aggregateProviderUsage(stages, elapsed);
  if (!observations.usage_complete) {
    const totals = { ...usage.totals };
    for (const key of USAGE_QUANTITIES) totals[key] = { total: null, complete: false, knownSubtotal: totals[key].knownSubtotal };
    usage = deepFreeze({ stages: usage.stages, totals });
  }
  // Missing cases stay in recall/no-match denominators; partial runs cannot inflate them.
  const answerable = expectedCases.filter(entry => entry.compatible_ids.length).length;
  const trueNoMatch = expectedCases.filter(entry => entry.cohorts.includes("true_no_match")).length;
  return { valid: true, diagnostics: [], report: deepFreeze({
    suiteFingerprint, scopeFingerprint, complete: seen.size === expectedCases.length, semanticQualityQualified: false,
    counts: { expected: expectedCases.length, observed: seen.size, missing: expectedCases.length - seen.size, byPartition, byDomain, byCohort },
    retrieval: { k: configuration.limits.maxCandidates, compatibleRecallAtK: rate(hits, answerable), topOnePrecision: rate(topHits, nonempty),
      noMatchFalsePositiveRate: rate(noMatchFalsePositives, trueNoMatch), shortlistSize: distribution(sizes), outcomes: retrievalOutcomes,
      forbiddenCandidateCases: forbiddenCandidates, policyViolationCases: policyCandidateCases, readToMutationCases: readMutationCases },
    selection: { outcomes: selectionOutcomes, compatibleAccuracy: rate(correctSelected, selectedMatched),
      abstentionRate: rate(selectionOutcomes.abstained!, submitted), coverage: rate(covered, answerableMatched),
      noMatchFalseSelectionRate: rate(noMatchSelections, trueNoMatch),
      forbiddenChoices, policyViolations: policyChoices, readToMutationChoices: readMutationChoices },
    latencyMs: distribution(latencies), accountingComplete: observations.usage_complete,
    usageComplete: observations.usage_complete && stages.every(stage => !stage.pending) && USAGE_QUANTITIES.every(key => usage.totals[key].complete), usage,
    provenance: { mockAttempts: stages.filter(stage => stage.mock).reduce((sum, x) => sum + x.providerAttempts, 0),
      liveAttempts: stages.filter(stage => !stage.mock).reduce((sum, x) => sum + x.providerAttempts, 0), pendingAttempts: stages.filter(stage => stage.pending).length }
  }) };
}
