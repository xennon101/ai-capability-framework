import { executeProviderAttempt } from "../runtime/provider-attempt.js";
import { assertProviderRunScope } from "../runtime/provider-run.js";
import type { ProviderAttemptInput } from "../runtime/provider-types.js";
import { hasOnlyKeys, isRecord } from "./configuration.js";
import type { DiscoveryDiagnosticCode } from "./diagnostics.js";
import { canonicalizeDiscoveryValue } from "./fingerprint.js";
import { selectionModelConfiguration, type resolveSelectionExecution } from "./selection-configuration.js";
import { parseSelectionResponse, SELECTION_OUTPUT_SCHEMA } from "./selection-response.js";
import type {
  CapabilitySelectionRequest, DiscoveryUsage, SelectionDecision, SelectionMessage, SelectionTask
} from "./types.js";

export interface SelectionAttemptRequest {
  request: CapabilitySelectionRequest;
  resolved: ReturnType<typeof resolveSelectionExecution>;
  messages: readonly SelectionMessage[];
  tasks: readonly SelectionTask[];
  attempt: 1 | 2;
  isCurrent: () => boolean;
}
export interface SelectionAttemptResult {
  decisions: readonly SelectionDecision[] | null;
  code?: DiscoveryDiagnosticCode;
  issues: readonly string[];
  usage: DiscoveryUsage;
}

/** The same managed attempt lifecycle is used by embeddings and ordinary model turns. */
export async function runSelectionAttempt(input: SelectionAttemptRequest): Promise<SelectionAttemptResult> {
  const { request, resolved, messages, tasks, attempt, isCurrent } = input;
  if (request.providerRun) assertProviderRunScope(request.providerRun, request.runId, { ledger: request.budget, policy: request.budgetPolicy });
  const options: ProviderAttemptInput<readonly SelectionDecision[], DiscoveryDiagnosticCode> = {
    runId: request.runId, requestId: request.requestId, signal: request.signal, deadlineAt: request.deadlineAt,
    stage: attempt === 1 ? "selection" : "selection_repair", configuration: resolved.model, mock: resolved.mock, attempt,
    maxInputTokens: resolved.limits.maxInputTokens, maxOutputTokens: resolved.limits.maxOutputTokens,
    maxEstimatedCostPerCall: request.maxEstimatedCostPerCall, estimateCost: resolved.execution.estimateCost,
    controls: request.routeRequest.controls, runtimeContext: request.routeRequest.builtContext.runtimeContext,
    guard: () => {
      if (!isCurrent()) return "stale_binding";
      if (request.client.transportVersion !== resolved.transportVersion || request.client.mock !== resolved.mock || canonicalizeDiscoveryValue(selectionModelConfiguration(request.client.configuration))
        !== canonicalizeDiscoveryValue(resolved.model)) return "selection_configuration_mismatch";
      return undefined;
    },
    invoke: context => request.client.generateStructured({ ...context, runId: request.runId, requestId: request.requestId,
      messages, outputSchema: SELECTION_OUTPUT_SCHEMA, maxInputTokens: resolved.limits.maxInputTokens, maxOutputTokens: resolved.limits.maxOutputTokens }),
    validate(response) {
      if (!isRecord(response) || !hasOnlyKeys(response, ["output", "usage", "responseRef", "providerAttempts"])
        || !Object.hasOwn(response, "output") || response.responseRef !== undefined && typeof response.responseRef !== "string") return { code: "provider_unavailable" };
      const parsed = parseSelectionResponse(response.output, tasks, resolved.limits.maxInputCharacters);
      return parsed.decisions ? { value: parsed.decisions } : { code: "invalid_selection_output", issues: parsed.issues };
    }
  };
  const result = request.providerRun ? await request.providerRun.attempt(options)
    : await executeProviderAttempt(options, { ledger: request.budget, policy: request.budgetPolicy });
  return { decisions: result.value ?? null, code: result.code, issues: result.issues, usage: result.usage };
}
