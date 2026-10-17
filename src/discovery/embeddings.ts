import { executeProviderAttempt } from "../runtime/provider-attempt.js";
import { assertProviderRunScope } from "../runtime/provider-run.js";
import type { ProviderAttemptInput } from "../runtime/provider-types.js";
import type { AicfRuntimeControls } from "../controls/types.js";
import type { AicfRuntimeContext } from "../runtime/types.js";
import { hasOnlyKeys, isRecord, nonblank } from "./configuration.js";
import { DiscoveryError, type DiscoveryDiagnostic, type DiscoveryDiagnosticCode } from "./diagnostics.js";
import {
  checkEmbeddingTexts, positiveInteger, resolveEmbeddingConfiguration, resolveEmbeddingExecution
} from "./embedding-configuration.js";
import type { EmbeddingExecutionOptions } from "./embedding-types.js";
import { fingerprintDiscoveryValue } from "./fingerprint.js";
import { deepFreeze } from "./json-snapshot.js";
import type {
  DiscoveryBudgetLedger, DiscoveryInvocation, DiscoveryUsage, EmbeddingClient, EmbeddingConfiguration
} from "./types.js";
import { validVectorBatch } from "./vectors.js";

export interface EmbeddingAttemptRequest extends DiscoveryInvocation {
  deadlineAt: number;
  client: EmbeddingClient;
  configuration: EmbeddingConfiguration;
  mock: boolean;
  texts: readonly string[];
  stage: "embedding_build" | "query_embedding";
  execution: EmbeddingExecutionOptions;
  maxVectorDimension: number;
  expectedDimension?: number;
  budget: DiscoveryBudgetLedger;
  controls?: AicfRuntimeControls;
  runtimeContext?: AicfRuntimeContext;
  /** Rechecks current source/authorization immediately after a reservation. */
  isCurrent?: () => boolean;
}

export type EmbeddingAttemptResult =
  | { status: "completed"; vectors: readonly (readonly number[])[]; vectorDimension: number; usage: DiscoveryUsage; diagnostics: readonly [] }
  | { status: "unavailable" | "cancelled"; usage: DiscoveryUsage; diagnostics: readonly DiscoveryDiagnostic[] };

export { stopReason, stopGate } from "../runtime/provider-stop.js";
export function validateProviderInvocation(request: DiscoveryInvocation & { budget?: DiscoveryBudgetLedger }): void {
  if (!nonblank(request.runId) || !nonblank(request.requestId) || typeof request.deadlineAt !== "number"
    || !Number.isFinite(request.deadlineAt) || request.signal !== undefined && !(request.signal instanceof AbortSignal)
    || typeof request.budget?.reserve !== "function" || typeof request.budget?.settle !== "function") {
    throw new DiscoveryError({ code: "invalid_configuration", message: "Embedding attempts require invocation IDs, a deadline, and a shared reservation ledger." });
  }
}

export async function runEmbeddingAttempt(request: EmbeddingAttemptRequest): Promise<EmbeddingAttemptResult> {
  validateProviderInvocation(request);
  const execution = resolveEmbeddingExecution(request.execution);
  const configuration = resolveEmbeddingConfiguration(request.configuration);
  checkEmbeddingTexts(request.texts, execution.limits);
  const texts = Object.freeze([...request.texts]);
  if (request.providerRun) assertProviderRunScope(request.providerRun, request.runId, { ledger: request.budget, policy: execution.budgetPolicy });
  const input: ProviderAttemptInput<{ vectors: readonly (readonly number[])[]; vectorDimension: number }, DiscoveryDiagnosticCode> = {
    ...request, maxInputTokens: execution.limits.maxInputTokens, maxEstimatedCostPerCall: execution.limits.maxEstimatedCostPerCall,
    protocolError: "invalid_embedding", estimateCost: execution.estimateCost,
    guard: () => {
      if (request.isCurrent && !request.isCurrent()) return "stale_binding";
      if (request.client.mock !== request.mock
        || fingerprintDiscoveryValue("embedding_configuration", resolveEmbeddingConfiguration(request.client.configuration))
          !== fingerprintDiscoveryValue("embedding_configuration", configuration)) return "embedding_configuration_mismatch";
      return undefined;
    },
    invoke: context => request.client.embed({ texts, configuration, maxInputTokens: execution.limits.maxInputTokens,
      runId: request.runId, requestId: request.requestId, ...context }),
    validate(response) {
      if (!isRecord(response) || !hasOnlyKeys(response, ["vectors", "configuration", "vectorDimension", "usage", "providerAttempts"])
        || !positiveInteger(response.vectorDimension) || response.vectorDimension > request.maxVectorDimension
        || request.expectedDimension !== undefined && response.vectorDimension !== request.expectedDimension
        || configuration.dimensions !== undefined && response.vectorDimension !== configuration.dimensions
        || !validVectorBatch(response.vectors, texts.length, response.vectorDimension)) return { code: "invalid_embedding" };
      if (fingerprintDiscoveryValue("embedding_configuration", resolveEmbeddingConfiguration(response.configuration as EmbeddingConfiguration))
        !== fingerprintDiscoveryValue("embedding_configuration", configuration)) return { code: "embedding_configuration_mismatch" };
      return { value: { vectors: deepFreeze(response.vectors.map(vector => [...vector])), vectorDimension: response.vectorDimension } };
    }
  };
  const result = request.providerRun ? await request.providerRun.attempt(input)
    : await executeProviderAttempt(input, { ledger: request.budget, policy: execution.budgetPolicy });
  if (result.code) return { status: result.code === "cancelled" || result.code === "deadline_exceeded" ? "cancelled" : "unavailable",
    usage: result.usage, diagnostics: [{ code: result.code, message: safeMessage(result.code) }] };
  return { status: "completed", ...result.value!, usage: result.usage, diagnostics: [] };
}

function safeMessage(code: DiscoveryDiagnosticCode): string {
  switch (code) {
    case "cancelled": return "The embedding operation was cancelled.";
    case "deadline_exceeded": return "The embedding deadline elapsed.";
    case "budget_denied": return "The shared embedding budget denied this attempt.";
    case "control_denied": return "Runtime controls denied the embedding attempt.";
    case "stale_binding": return "Source or authorization bindings changed during embedding.";
    case "embedding_configuration_mismatch": return "Embedding model configuration changed or did not match.";
    case "invalid_embedding": return "The embedding client returned incompatible vectors or attempt counts.";
    case "accounting_unavailable": return "Embedding reservation or settlement accounting is unavailable.";
    default: return "The embedding provider was unavailable.";
  }
}
