/** Optional, release-candidate public capability discovery API. */
export { ModelCapabilitySelector } from "./selection.js";
export { buildCapabilitySelectionTasks } from "./selection-cards.js";
export type { BuildCapabilitySelectionTasksRequest } from "./selection-cards.js";
export type { CapabilitySelectRequest } from "./selection-types.js";
export { createCapabilityDiscovery, DISCOVERY_STANDARD_PROFILE } from "./facade.js";
export type { CapabilityDiscovery, CapabilityDiscoveryOptions, CapabilityDiscoveryEmbeddingOptions,
  CapabilitySearchRequest, CapabilityDiscoveryEligibility, CapabilityResultRouter } from "./facade.js";
export { createInMemoryDiscoveryBudget } from "./budget.js";
export type { DiscoveryBudgetScope, InMemoryDiscoveryBudgetOptions } from "./budget.js";
export { CapabilityDiscoverer } from "./discoverer.js";
export type { CapabilityDiscovererOptions } from "./discoverer.js";
export { buildCapabilityEmbeddingIndex } from "./index-builder.js";
export {
  validateCapabilityEmbeddingIndex, serializeCapabilityEmbeddingIndex, parseCapabilityEmbeddingIndex,
  loadCapabilityEmbeddingIndex, publishCapabilityEmbeddingIndex
} from "./index-validation.js";
export { aggregateDiscoveryUsage } from "./usage.js";
export type {
  DeepReadonly,
  CapabilityEmbeddingIndex,
  EmbeddingIndexLimits,
  EmbeddingCallLimits,
  EmbeddingExecutionOptions,
  HybridDiscoveryDependencies,
  EmbeddingIndexExpected,
  EmbeddingIndexValidationResult,
  CapabilityEmbeddingIndexBuildRequest,
  CapabilityEmbeddingIndexBuildResult,
  CapabilityEmbeddingIndexStore
} from "./embedding-types.js";
export { buildCapabilitySearchCorpus } from "./corpus.js";
export { RetrievalCapabilityRouter } from "./router.js";
export type { RetrievalCapabilityRouteRequest, RetrievalCapabilityRouterOptions } from "./router.js";
export { DiscoveryError } from "./diagnostics.js";
export type { DiscoveryDiagnostic, DiscoveryDiagnosticCode } from "./diagnostics.js";
export { resolveDiscoveryMetadata } from "./metadata.js";
export { canonicalizeDiscoveryValue, fingerprintDiscoveryValue, hashDiscoveryContent } from "./fingerprint.js";
export type { DiscoveryFingerprintKind, DiscoveryFingerprintPayloads, CapabilityVersionBinding } from "./fingerprint.js";
export { DISCOVERY_BINDING_VERSIONS, DISCOVERY_SCHEMA_VERSION, DISCOVERY_DEFAULT_LIMITS, DISCOVERY_HARD_LIMITS } from "./versions.js";
export { LEXICAL_TOKENIZER_VERSION, LEXICAL_RANKER_VERSION, tokenizeDiscoveryText } from "./lexical.js";
export type {
  DiscoveryLimits,
  LexicalDiscoveryConfiguration,
  HybridDiscoveryConfiguration,
  DiscoveryConfiguration,
  DiscoveryFragment,
  DiscoveryQuery,
  EmbeddingConfiguration,
  DiscoveryStage,
  DiscoveryInvocation,
  CapabilityDiscoveryRequest,
  RankedCapabilityCandidate,
  CapabilityDiscoveryResult,
  CapabilityRetrievalDocument,
  CapabilitySearchCorpus,
  ResolvedLexicalDiscoveryConfiguration,
  ResolvedHybridDiscoveryConfiguration,
  ResolvedDiscoveryConfiguration,
  LexicalRankerCandidate,
  CapabilityLexicalRanker,
  DiscoveryBudgetReservation,
  DiscoveryBudgetLedger,
  ProviderAttemptContext,
  EmbeddingClient,
  DiscoveryProviderFailure,
  DiscoveryProviderError,
  SelectionMessage,
  SelectionModelClient,
  CapabilityCandidateCard,
  CapabilitySelectionInputTask,
  SelectionTask,
  SelectionLimits,
  CapabilitySelectionRequest,
  SelectionDecision,
  SelectionResponse,
  CapabilitySelectionBatchResult,
  CapabilitySelectionOutcome,
  DiscoveryRouteResult,
  ResolvedDiscoveryMetadata,
  DiscoveryMetadata,
  ProviderModelConfiguration,
  ModelUsage,
  UsageQuantity,
  DiscoveryUsageTotals,
  DiscoveryStageUsage,
  DiscoveryUsage,
  ProviderAttemptReservation,
  ProviderAttemptSettlement
} from "./types.js";

export { createDiscoverySnapshot, validateDiscoverySnapshot, replayDiscoverySnapshot, createDiscoveryReplayHandler } from "./replay.js";
export type { DiscoverySnapshotInput, DiscoveryReplayFixtures, DiscoveryReplayResult } from "./replay.js";
export type { CapabilityEmbeddingIndexArtifact, CapabilityDiscoverySnapshot } from "../generated/manifest-types.js";

export { evaluateCapabilityDiscovery, fingerprintDiscoveryEvaluationSuite } from "./evaluation.js";
export type { DiscoveryEvaluationSuite, DiscoveryEvaluationObservations, DiscoveryEvaluationRate, DiscoveryEvaluationDistribution, DiscoveryEvaluationReport, DiscoveryEvaluationResult, EvaluateCapabilityDiscoveryRequest, DiscoveryEvaluationDiagnostic } from "./evaluation.js";
