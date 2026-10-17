import type {
  CapabilityDiscoveryRequest,
  CapabilityDiscoveryResult,
  CapabilitySelectionOutcome,
  CapabilityLexicalRanker,
  DiscoveryBudgetLedger,
  DiscoveryBudgetReservation,
  DiscoveryConfiguration,
  EmbeddingClient,
  EmbeddingConfiguration,
  HybridDiscoveryConfiguration,
  ModelUsage,
  ProviderAttemptReservation,
  ProviderAttemptSettlement,
  ProviderModelConfiguration,
  SelectionModelClient,
  SelectionResponse,
  UsageQuantity
} from "../../discovery/types.js";
import type { CapabilityRouteRequest } from "../../runtime/types.js";
import type { CapabilityDiscoveryOptions, CapabilitySearchRequest, CapabilityResultRouter } from "../../discovery/facade.js";
import type { DiscoveryBudgetScope, InMemoryDiscoveryBudgetOptions } from "../../discovery/budget.js";
import type { CapabilitySelectRequest } from "../../discovery/selection-types.js";
import type { CapabilitySelectionBatchResult, CapabilitySelectionInputTask } from "../../discovery/types.js";
import type { DiscoveryFingerprintPayloads } from "../../discovery/fingerprint.js";
import type {
  CapabilityEmbeddingIndex, CapabilityEmbeddingIndexBuildRequest, CapabilityEmbeddingIndexStore
} from "../../discovery/embedding-types.js";

type Assert<T extends true> = T;
type Assignable<A, B> = [A] extends [B] ? true : false;
type Not<T extends boolean> = T extends true ? false : true;

type SimpleFacadeConfiguration = Assert<Assignable<{ registry: CapabilityRouteRequest["registry"] }, CapabilityDiscoveryOptions>>;
type SimpleFacadeSearch = Assert<Assignable<{
  tasks: [{ id: "ticket"; text: "Read ticket" }]; runtimeContext: CapabilityRouteRequest["builtContext"]["runtimeContext"];
}, CapabilitySearchRequest>>;
type HybridFacadeRequiresTokenCeiling = Assert<Not<Assignable<{
  registry: CapabilityRouteRequest["registry"]; mode: "hybrid"; embedding: { client: EmbeddingClient; index: unknown };
}, CapabilityDiscoveryOptions>>>;
type ScopedBudgetUsesExistingLedger = Assert<Assignable<DiscoveryBudgetScope["ledger"], DiscoveryBudgetLedger>>;
type ResultRouterUsesExistingRuntime = Assert<Assignable<CapabilityResultRouter, import("../../runtime/types.js").AicfCapabilityRouter>>;
type InMemoryBudgetRequiresCaps = Assert<Not<Assignable<{ runId: string }, InMemoryDiscoveryBudgetOptions>>>;
type FacadeSelectionCompiles = Assert<Assignable<{
  results: readonly CapabilityDiscoveryResult[]; client: ExampleSelectionClient; budget: DiscoveryBudgetScope;
  maxInputTokens: 4000; maxOutputTokens: 1000;
}, CapabilitySelectRequest>>;
type SelectorRequiresMockMarker = Assert<Not<Assignable<{
  configuration: ProviderModelConfiguration; generateStructured: SelectionModelClient["generateStructured"];
}, SelectionModelClient>>>;
type BatchOwnsUsage = Assert<Assignable<CapabilitySelectionBatchResult["usage"], CapabilityDiscoveryResult["usage"]>>;
type SelectionInputNeedsNoManualCards = Assert<Assignable<{
  queryId: string; requestText: string; discovery: CapabilityDiscoveryResult;
}, CapabilitySelectionInputTask>>;

type LexicalConfigurationCompiles = Assert<Assignable<
  { mode: "lexical"; policyVersion: "example.v1" }, DiscoveryConfiguration
>>;
type HybridConfigurationCompiles = Assert<Assignable<
  { mode: "hybrid"; policyVersion: "example.v1"; weights: { lexical: 0.4; semantic: 0.6 }; failurePolicy: "unavailable" },
  DiscoveryConfiguration
>>;
type HybridRequiresWeights = Assert<Not<Assignable<
  { mode: "hybrid"; policyVersion: "example.v1"; failurePolicy: "unavailable" }, HybridDiscoveryConfiguration
>>>;
type HybridRequiresFailurePolicy = Assert<Not<Assignable<
  { mode: "hybrid"; policyVersion: "example.v1"; weights: { lexical: 0.4; semantic: 0.6 } }, HybridDiscoveryConfiguration
>>>;
type RequestCompiles = Assert<Assignable<{
  runId: "run_example"; requestId: "request_example"; routeRequest: CapabilityRouteRequest;
  queries: readonly [{ id: "query_example"; fragments: readonly [{ key: "request"; text: "Read ticket details" }] }];
}, CapabilityDiscoveryRequest>>;
type ResultCompiles = Assert<Assignable<{
  queryId: "query_example"; status: "matched"; requestedMode: "lexical"; actualMode: "lexical";
  candidates: readonly []; corpusFingerprint: string; eligibilityFingerprint: string; retrievalPolicyFingerprint: string; policyVersion: "example.v1";
  usage: CapabilityDiscoveryResult["usage"]; diagnostics: readonly [];
}, CapabilityDiscoveryResult>>;
type IncompleteUsageCompiles = Assert<Assignable<{ total: null; knownSubtotal: 12; complete: false }, UsageQuantity>>;
type UnknownProviderUsageCompiles = Assert<Assignable<{}, ModelUsage>>;
type IncompleteUsageCannotClaimTotal = Assert<Not<Assignable<{ total: 12; knownSubtotal: 12; complete: false }, UsageQuantity>>>;
type LexicalRejectsHybridWeights = Assert<Not<Assignable<
  { mode: "lexical"; policyVersion: "example.v1"; weights: { lexical: 1; semantic: 0 } }, DiscoveryConfiguration
>>>;
type AbstentionCompiles = Assert<Assignable<{
  schema_version: "1.0"; decisions: readonly [{
    query_id: "query_example"; decision: "abstain"; capability_id: null; reason_code: "ambiguous_request";
  }];
}, SelectionResponse>>;
type AbstentionRejectsCapability = Assert<Not<Assignable<{
  schema_version: "1.0"; decisions: readonly [{
    query_id: "query_example"; decision: "abstain"; capability_id: "support.ticket.get"; reason_code: "ambiguous_request";
  }];
}, SelectionResponse>>>;
type SelectedOutcomeRequiresVersion = Assert<Not<Assignable<{
  status: "selected"; queryId: string; capabilityId: string; reasonCode: "supported_candidate";
  selectorFingerprint: string; inputBindingHash: string; usage: CapabilityDiscoveryResult["usage"]; diagnostics: [];
}, CapabilitySelectionOutcome>>>;
type RegistryBindingCompiles = Assert<Assignable<{
  capabilities: readonly [{ capabilityId: "support.ticket.get"; capabilityVersion: "1.0.0"; sourceContentHash: string }];
}, DiscoveryFingerprintPayloads["registry_source"]>>;
type IndexRequiresVectorHashes = Assert<Not<Assignable<{
  schemaVersion: "1.0"; projectionVersion: string; registrySourceFingerprint: string; corpusFingerprint: string;
  embedding: EmbeddingConfiguration; embeddingConfigurationFingerprint: string; mock: boolean;
  vectorDimension: number; indexFingerprint: string; builtAt: string;
  entries: [{ capabilityId: string; capabilityVersion: string; documentHash: string; vector: [number] }];
}, CapabilityEmbeddingIndex>>>;
type BuildRequiresLedger = Assert<Not<Assignable<{
  corpus: CapabilityEmbeddingIndexBuildRequest["corpus"]; client: EmbeddingClient;
}, CapabilityEmbeddingIndexBuildRequest>>>;
type AsyncLexicalRankerRejected = Assert<Not<Assignable<{
  version: "example.v1"; rank(input: Parameters<CapabilityLexicalRanker["rank"]>[0]): Promise<[]>;
}, CapabilityLexicalRanker>>>;

declare class ExampleEmbeddingClient implements EmbeddingClient {
  readonly mock: boolean;
  configuration: EmbeddingConfiguration;
  embed(input: Parameters<EmbeddingClient["embed"]>[0]): Promise<{
    vectors: number[][];
    configuration: EmbeddingConfiguration;
    vectorDimension: number;
    usage: { inputTokens: number; totalTokens: number };
    providerAttempts: number;
  }>;
}

declare class ExampleSelectionClient implements SelectionModelClient {
  readonly mock: boolean;
  configuration: ProviderModelConfiguration;
  generateStructured(input: Parameters<SelectionModelClient["generateStructured"]>[0]): Promise<{
    output: SelectionResponse;
    usage: ModelUsage;
    providerAttempts: number;
  }>;
}

declare class ExampleSharedBudget implements DiscoveryBudgetLedger {
  reserve(input: ProviderAttemptReservation): Promise<DiscoveryBudgetReservation>;
  settle(reservationId: string, result: ProviderAttemptSettlement): Promise<void>;
}

declare class ExampleLexicalRanker implements CapabilityLexicalRanker {
  readonly version: "example.ranker.v1";
  rank(input: Parameters<CapabilityLexicalRanker["rank"]>[0]): ReturnType<CapabilityLexicalRanker["rank"]>;
}

declare class ExampleIndexStore implements CapabilityEmbeddingIndexStore {
  read(key: string): Promise<string | null>;
  replace(key: string, serializedArtifact: string): Promise<void>;
}

