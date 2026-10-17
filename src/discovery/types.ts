import type { ModelUsage, UsageQuantity, ProviderUsage as DiscoveryUsage, ProviderAttemptReservation, ProviderAttemptSettlement, ProviderModelConfiguration } from "../runtime/provider-types.js";
import type { BudgetPolicy, BudgetUsage } from "../controls/types.js";
import type { CapabilityRouteRequest, RuntimeCapabilitySlice } from "../runtime/types.js";
import type { CapabilityManifest, JsonObject, ManifestRegistry } from "../types.js";
import type { DiscoveryDiagnostic } from "./diagnostics.js";

export type { DiscoveryMetadata } from "../generated/manifest-types.js";

export interface DiscoveryLimits {
  maxQueries: number;
  maxFragmentsPerQuery: number;
  maxQueryCharacters: number;
  maxCandidates: number;
  aliasDiversitySlots: 0 | 1;
}

interface DiscoveryConfigurationBase {
  limits?: Partial<DiscoveryLimits>;
  aliasWeight?: number;
  minRetrievalScore?: number;
  policyVersion: string;
}

export interface LexicalDiscoveryConfiguration extends DiscoveryConfigurationBase {
  mode: "lexical";
  weights?: never;
  failurePolicy?: never;
}

export interface HybridDiscoveryConfiguration extends DiscoveryConfigurationBase {
  mode: "hybrid";
  weights: { semantic: number; lexical: number };
  failurePolicy: "unavailable" | "lexical_fallback";
}

export type DiscoveryConfiguration = LexicalDiscoveryConfiguration | HybridDiscoveryConfiguration;

export interface DiscoveryFragment {
  key: string;
  text: string;
}

export interface DiscoveryQuery {
  id: string;
  fragments: readonly DiscoveryFragment[];
}

export type { ProviderModelConfiguration } from "../runtime/provider-types.js";
export interface EmbeddingConfiguration extends ProviderModelConfiguration {
  dimensions?: number;
}

export type DiscoveryStage = import("../runtime/provider-types.js").ProviderStage;

export interface DiscoveryInvocation {
  providerRun?: import("../runtime/provider-types.js").AicfProviderRun;
  runId: string;
  requestId: string;
  signal?: AbortSignal;
  /** Absolute Unix time in milliseconds. Required by live provider attempts. */
  deadlineAt?: number;
}

export interface CapabilityDiscoveryRequest extends DiscoveryInvocation {
  routeRequest: CapabilityRouteRequest;
  queries: readonly DiscoveryQuery[];
  /** May lower, but never expand, the configured candidate limit. */
  maxCandidates?: number;
  budget?: DiscoveryBudgetLedger;
}

export interface RankedCapabilityCandidate {
  capabilityId: string;
  capabilityVersion: string;
  rank: number;
  scores: {
    lexical: number;
    aliasPhrase: number;
    semantic: number | null;
    final: number;
  };
  inclusionReason: "aggregate_ranking" | "alias_diversity";
  matchedAliases: readonly string[];
}

export interface CapabilityDiscoveryResult {
  queryId: string;
  status: "matched" | "no_match" | "unavailable" | "cancelled";
  requestedMode: "lexical" | "hybrid";
  actualMode: "lexical" | "hybrid" | null;
  degradedReason?: DiscoveryDiagnostic["code"];
  candidates: readonly RankedCapabilityCandidate[];
  corpusFingerprint: string;
  eligibilityFingerprint: string;
  retrievalPolicyFingerprint: string;
  indexFingerprint?: string;
  policyVersion: string;
  usage: DiscoveryUsage;
  diagnostics: readonly DiscoveryDiagnostic[];
}

export interface CapabilityRetrievalDocument {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly riskTier: CapabilityManifest["risk_tier"];
  readonly name: string;
  readonly summary: string;
  readonly aliases: readonly string[];
  readonly text: string;
  readonly tokens: readonly string[];
  readonly documentHash: string;
}

export interface CapabilitySearchCorpus {
  readonly schemaVersion: "1.0";
  readonly projectionVersion: string;
  readonly registrySourceFingerprint: string;
  readonly corpusFingerprint: string;
  readonly documents: readonly CapabilityRetrievalDocument[];
}

export interface ResolvedLexicalDiscoveryConfiguration {
  readonly mode: "lexical";
  readonly policyVersion: string;
  readonly limits: Readonly<DiscoveryLimits>;
  readonly aliasWeight: number;
  readonly minRetrievalScore: number;
}

export interface ResolvedHybridDiscoveryConfiguration extends Omit<ResolvedLexicalDiscoveryConfiguration, "mode"> {
  readonly mode: "hybrid";
  readonly weights: Readonly<{ semantic: number; lexical: number }>;
  readonly failurePolicy: "unavailable" | "lexical_fallback";
}

export type ResolvedDiscoveryConfiguration = ResolvedLexicalDiscoveryConfiguration | ResolvedHybridDiscoveryConfiguration;

export interface LexicalRankerCandidate {
  readonly capabilityId: string;
  readonly scores: RankedCapabilityCandidate["scores"];
}

/** Synchronous host policy. Identity, admission, ordering and bounds remain framework-owned. */
export interface CapabilityLexicalRanker {
  readonly version: string;
  rank(input: {
    query: Readonly<DiscoveryQuery>;
    documents: readonly CapabilityRetrievalDocument[];
    configuration: ResolvedLexicalDiscoveryConfiguration;
  }): readonly LexicalRankerCandidate[];
}

export type {
  ModelUsage, UsageQuantity, ProviderUsageTotals as DiscoveryUsageTotals,
  ProviderStageUsage as DiscoveryStageUsage, ProviderUsage as DiscoveryUsage,
  ProviderAttemptReservation, ProviderAttemptSettlement
} from "../runtime/provider-types.js";
export type DiscoveryBudgetReservation =
  | { status: "reserved"; reservationId: string }
  | { status: "denied"; diagnostic: DiscoveryDiagnostic };
export type DiscoveryBudgetLedger = import("../runtime/provider-types.js").ProviderBudgetLedger;

export interface ProviderAttemptContext extends DiscoveryInvocation {
  beforeProviderCall?: () => void;
  deadlineAt: number;
  attempt: number;
}

/** One underlying attempt per invocation; disable retries and enforce maxInputTokens before provider work. */
export interface EmbeddingClient {
  readonly mock: boolean;
  configuration: EmbeddingConfiguration;
  embed(input: ProviderAttemptContext & {
    texts: readonly string[];
    configuration: EmbeddingConfiguration;
    maxInputTokens: number;
  }): Promise<{
    vectors: readonly (readonly number[])[];
    configuration: EmbeddingConfiguration;
    vectorDimension: number;
    usage?: ModelUsage;
    providerAttempts: number;
  }>;
}

export interface DiscoveryProviderFailure {
  diagnostic: DiscoveryDiagnostic;
  usage?: ModelUsage;
  providerAttempts: number;
}

/** A client may reject with this shape to retain known failed-attempt usage. */
export interface DiscoveryProviderError extends Error, DiscoveryProviderFailure {}

export interface SelectionMessage {
  role: "system" | "user";
  content: string;
}

export interface SelectionModelClient {
  readonly transportVersion?: string;
  readonly mock: boolean;
  configuration: ProviderModelConfiguration;
  generateStructured(input: ProviderAttemptContext & {
    messages: readonly SelectionMessage[];
    outputSchema: JsonObject;
    maxInputTokens: number;
    maxOutputTokens: number;
  }): Promise<{
    output: unknown;
    usage?: ModelUsage;
    responseRef?: string;
    providerAttempts: number;
  }>;
}

export interface CapabilityCandidateCard {
  capabilityId: string;
  capabilityVersion: string;
  name: string;
  modelDescription: string;
  whenToUse: readonly string[];
  whenNotToUse: readonly string[];
  capabilityType: CapabilityManifest["capability_type"];
  exposedOperations: readonly ("select" | "prepare")[];
  inputFields: readonly string[];
  proposedOperation: "read" | "prepare";
}

export interface CapabilitySelectionInputTask {
  queryId: string;
  requestText: string;
  context?: JsonObject;
  discovery: CapabilityDiscoveryResult;
}

export interface SelectionTask extends CapabilitySelectionInputTask {
  cards: readonly CapabilityCandidateCard[];
  inputBindingHash: string;
}

export interface SelectionLimits {
  maxTasks: number;
  maxInputCharacters: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxAttempts: 1 | 2;
}

export interface CapabilitySelectionRequest extends DiscoveryInvocation {
  deadlineAt: number;
  tasks: readonly CapabilitySelectionInputTask[];
  registry: ManifestRegistry;
  routeRequest: CapabilityRouteRequest;
  client: SelectionModelClient;
  limits: SelectionLimits;
  budget: DiscoveryBudgetLedger;
  budgetPolicy: BudgetPolicy;
  maxEstimatedCostPerCall?: number;
  estimateCost?: (usage: Readonly<ModelUsage>, configuration: Readonly<ProviderModelConfiguration>) => number | undefined;
  /** May tighten, but never bypass, the framework's binding checks. */
  isCurrent?: () => boolean;
}

export type SelectionDecision =
  | { query_id: string; decision: "select"; capability_id: string; reason_code: "supported_candidate" }
  | {
    query_id: string;
    decision: "abstain";
    capability_id: null;
    reason_code: "no_suitable_candidate" | "ambiguous_request" | "insufficient_context";
  };

export interface SelectionResponse {
  schema_version: "1.0";
  decisions: readonly SelectionDecision[];
}

/** @inline */
interface SelectionOutcomeBase {
  queryId: string;
  selectorFingerprint: string;
  inputBindingHash: string;
  diagnostics: readonly DiscoveryDiagnostic[];
}

export interface CapabilitySelectionBatchResult {
  discovery: readonly CapabilityDiscoveryResult[];
  outcomes: readonly CapabilitySelectionOutcome[];
  usage: DiscoveryUsage;
  diagnostics: readonly DiscoveryDiagnostic[];
}

export type CapabilitySelectionOutcome = SelectionOutcomeBase & (
  | { status: "selected"; capabilityId: string; capabilityVersion: string; reasonCode: "supported_candidate" }
  | {
    status: "abstained";
    capabilityId: null;
    reasonCode: "no_suitable_candidate" | "ambiguous_request" | "insufficient_context";
  }
  | {
    status: "unavailable" | "invalid_output" | "cancelled";
    capabilityId: null;
    reasonCode: DiscoveryDiagnostic["code"];
  }
);

export interface DiscoveryRouteResult {
  selectionBatch?: CapabilitySelectionBatchResult;
  slice: RuntimeCapabilitySlice;
  discovery: readonly CapabilityDiscoveryResult[];
  selection?: readonly CapabilitySelectionOutcome[];
}

export interface ResolvedDiscoveryMetadata {
  schemaVersion: "1.0";
  summary: string;
  aliases: readonly string[];
}

