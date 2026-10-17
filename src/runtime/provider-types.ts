import type { BudgetPolicy, BudgetUsage } from "../controls/types.js";
import type { AicfRuntimeControls } from "../controls/types.js";
import type { AicfRuntimeContext } from "./types.js";
import type { AicfRuntimeTraceEvent, AicfTraceSink } from "../observability/types.js";

export interface ProviderDiagnostic { code: string; message: string; }
export type ProviderStage = "embedding_build" | "query_embedding" | "selection" | "selection_repair" | "model_tool_loop" | "planning" | "response_assembly";
export interface ProviderInvocation { runId: string; requestId: string; signal?: AbortSignal; deadlineAt?: number; }
export interface ProviderModelConfiguration {
  provider: string;
  model: string;
  configurationId: string;
  revision?: string;
}

/** Missing provider-reported quantities are unknown, not zero. */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  estimatedCost?: number;
}

export type UsageQuantity =
  | { total: number; knownSubtotal: number; complete: true }
  | { total: null; knownSubtotal: number; complete: false };

export interface ProviderUsageTotals {
  providerAttempts: number;
  completedResponses: number;
  retryAttempts: number;
  repairAttempts: number;
  inputTokens: UsageQuantity;
  outputTokens: UsageQuantity;
  totalTokens: UsageQuantity;
  cachedInputTokens: UsageQuantity;
  reasoningTokens: UsageQuantity;
  estimatedCost: UsageQuantity;
  elapsedMs: number;
}

export interface ProviderStageUsage extends ProviderUsageTotals {
  attemptId?: string;
  reasonCode?: string;
  stage: ProviderStage;
  configuration: ProviderModelConfiguration;
  mock: boolean;
  cacheHits: number;
  outcome: ProviderAttemptSettlement["outcome"];
  /** The invocation returned before this provider attempt finished. */
  pending: boolean;
}

export interface ProviderUsage {
  stages: readonly ProviderStageUsage[];
  totals: ProviderUsageTotals;
}

export interface ProviderAttemptReservation extends ProviderInvocation {
  deadlineAt: number;
  stage: ProviderStage;
  attempt: number;
  configuration: ProviderModelConfiguration;
  policy: BudgetPolicy;
  requestedUsage: BudgetUsage;
}

export type ProviderBudgetReservation =
  | { status: "reserved"; reservationId: string }
  | { status: "denied"; diagnostic: ProviderDiagnostic };

export interface ProviderAttemptSettlement {
  outcome: "completed" | "failed" | "cancelled" | "discarded";
  usage: ModelUsage;
  elapsedMs: number;
  completedResponses: number;
  providerAttempts: number;
}

/** Shared with other stages in the host's run; durable enforcement is host-owned. */
export interface ProviderBudgetLedger {
  reserve(input: ProviderAttemptReservation): Promise<ProviderBudgetReservation>;
  settle(reservationId: string, result: ProviderAttemptSettlement): Promise<void>;
}


export interface ProviderBudgetScope { ledger: ProviderBudgetLedger; policy: BudgetPolicy; }
export interface ProviderAttemptInput<T, C extends string = string> extends ProviderInvocation {
  deadlineAt: number;
  stage: ProviderStage;
  configuration: ProviderModelConfiguration;
  mock: boolean;
  attempt?: number;
  maxInputTokens: number;
  maxOutputTokens?: number;
  maxEstimatedCostPerCall?: number;
  controls?: AicfRuntimeControls;
  runtimeContext?: AicfRuntimeContext;
  guard?: () => C | undefined;
  protocolError?: C;
  invoke(context: { signal: AbortSignal; deadlineAt: number; attempt: number; beforeProviderCall: () => void }): Promise<unknown>;
  validate(response: unknown): { value?: T; code?: C; issues?: readonly string[] };
  estimateCost?: (usage: Readonly<ModelUsage>, configuration: Readonly<ProviderModelConfiguration>) => number | undefined;
}
export type ProviderFailureCode = "provider_unavailable" | "accounting_unavailable" | "budget_denied" | "control_denied" | "cancelled" | "deadline_exceeded";
export interface ProviderAttemptResult<T, C extends string = string> {
  value?: T;
  code?: C | ProviderFailureCode;
  issues: readonly string[];
  usage: ProviderUsage;
}
export interface ProviderRunSnapshot {
  runId: string;
  usage: ProviderUsage;
  elapsedMs: number;
  attemptElapsedMs: number;
  pendingAttempts: number;
  diagnostics: readonly ProviderDiagnostic[];
  events: readonly AicfRuntimeTraceEvent[];
}
export interface AicfProviderRun {
  readonly runId: string;
  readonly budget: ProviderBudgetScope;
  readonly deadlineAt: number;
  readonly signal?: AbortSignal;
  attempt<T, C extends string = string>(input: Omit<ProviderAttemptInput<T, C>, "runId" | "deadlineAt"> & { runId?: string; deadlineAt?: number }): Promise<ProviderAttemptResult<T, C>>;
  snapshot(): ProviderRunSnapshot;
  record(type: AicfRuntimeTraceEvent["type"], requestId: string, metadata: ProviderTraceMetadata): void;
}
/** Only these bounded metadata fields may enter new provider/discovery events. */
export interface ProviderTraceMetadata {
  stage?: ProviderStage; outcome?: string; reasonCode?: string; queryId?: string;
  configurationId?: string; provider?: string; model?: string; mock?: boolean;
  fingerprint?: string; corpusFingerprint?: string; indexFingerprint?: string;
  retrievalPolicyFingerprint?: string; eligibilityFingerprint?: string;
  candidateCount?: number; taskCount?: number; attemptId?: string;
  providerAttempts?: number; completedResponses?: number; elapsedMs?: number; pending?: boolean;
  inputTokens?: UsageQuantity; outputTokens?: UsageQuantity; totalTokens?: UsageQuantity;
  cachedInputTokens?: UsageQuantity; reasoningTokens?: UsageQuantity; estimatedCost?: UsageQuantity;
}
export interface CreateAicfProviderRunOptions {
  runId: string; budget: ProviderBudgetScope; deadlineAt: number; signal?: AbortSignal; traceSink?: AicfTraceSink;
}
