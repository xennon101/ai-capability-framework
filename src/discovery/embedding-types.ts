import type { AicfRuntimeControls, BudgetPolicy } from "../controls/types.js";
import type { CapabilityEmbeddingIndexArtifact } from "../generated/manifest-types.js";
import type { AicfRuntimeContext } from "../runtime/types.js";
import type { DiscoveryDiagnostic } from "./diagnostics.js";
import type {
  CapabilitySearchCorpus, DiscoveryBudgetLedger, DiscoveryInvocation, DiscoveryUsage, EmbeddingClient,
  EmbeddingConfiguration, ModelUsage
} from "./types.js";

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type CapabilityEmbeddingIndex = DeepReadonly<CapabilityEmbeddingIndexArtifact>;

export interface EmbeddingIndexLimits {
  maxArtifactBytes: number;
  maxEntries: number;
  maxVectorDimension: number;
}

export interface EmbeddingCallLimits {
  maxInputTokens: number;
  maxCharactersPerText: number;
  maxCharactersPerCall: number;
  maxEstimatedCostPerCall?: number;
}

export interface EmbeddingExecutionOptions {
  limits: EmbeddingCallLimits;
  budgetPolicy: BudgetPolicy;
  /** Return undefined when the available reported usage cannot be priced. */
  estimateCost?: (usage: Readonly<ModelUsage>, configuration: Readonly<EmbeddingConfiguration>) => number | undefined;
}

export interface HybridDiscoveryDependencies {
  client: EmbeddingClient;
  index: unknown;
  indexLimits: EmbeddingIndexLimits;
  execution: EmbeddingExecutionOptions;
}

export interface EmbeddingIndexExpected {
  corpus: CapabilitySearchCorpus;
  configuration: EmbeddingConfiguration;
  mock: boolean;
  limits: EmbeddingIndexLimits;
}

export type EmbeddingIndexValidationResult =
  | { valid: true; index: CapabilityEmbeddingIndex; diagnostics: readonly [] }
  | { valid: false; diagnostics: readonly DiscoveryDiagnostic[] };

export interface CapabilityEmbeddingIndexBuildRequest extends DiscoveryInvocation {
  deadlineAt: number;
  corpus: CapabilitySearchCorpus;
  client: EmbeddingClient;
  limits: EmbeddingIndexLimits;
  execution: EmbeddingExecutionOptions;
  batchSize: number;
  maxProviderCalls: number;
  budget: DiscoveryBudgetLedger;
  controls?: AicfRuntimeControls;
  runtimeContext?: AicfRuntimeContext;
}

export type CapabilityEmbeddingIndexBuildResult =
  | { status: "built"; index: CapabilityEmbeddingIndex; usage: DiscoveryUsage; diagnostics: readonly DiscoveryDiagnostic[] }
  | { status: "unavailable" | "cancelled"; index: null; usage: DiscoveryUsage; diagnostics: readonly DiscoveryDiagnostic[] };

/** Host implementations replace complete values atomically; no partial artifact may become visible. */
export interface CapabilityEmbeddingIndexStore {
  read(key: string): Promise<string | null>;
  replace(key: string, serializedArtifact: string): Promise<void>;
}
