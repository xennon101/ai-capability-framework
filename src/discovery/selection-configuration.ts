import { hasOnlyKeys, isRecord } from "./configuration.js";
import { DiscoveryError, type DiscoveryDiagnosticCode } from "./diagnostics.js";
import { positiveInteger, resolveEmbeddingConfiguration, resolveEmbeddingExecution } from "./embedding-configuration.js";
import { fingerprintDiscoveryValue } from "./fingerprint.js";
import { boundedJsonSnapshot, deepFreeze } from "./json-snapshot.js";
import type { CapabilitySelectionRequest, ProviderModelConfiguration, SelectionLimits } from "./types.js";
import { SELECTION_DEFAULT_LIMITS, SELECTION_HARD_LIMITS } from "./versions.js";

export const SELECTION_PROMPT_VERSION = "capability-choice.v1";
export const CANDIDATE_CARD_PROJECTION_VERSION = "complete-guidance.v1";
export const SELECTION_OUTPUT_SCHEMA_VERSION = "1.0";

export function selectionError(code: DiscoveryDiagnosticCode, message = "Selection inputs or bindings are invalid."): DiscoveryError {
  return new DiscoveryError({ code, message });
}

export function selectionJson<T>(value: T, maxCharacters: number): T {
  try {
    const snapshot = boundedJsonSnapshot(value, maxCharacters * 4) as T;
    if (JSON.stringify(snapshot).length > maxCharacters) throw new Error();
    return deepFreeze(snapshot);
  } catch { throw selectionError("input_limit_exceeded", "Selection requires bounded finite JSON without accessors or cycles."); }
}

export function resolveSelectionLimits(value: Partial<SelectionLimits>): Readonly<SelectionLimits> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["maxTasks", "maxInputCharacters", "maxInputTokens", "maxOutputTokens", "maxAttempts"])) {
    throw selectionError("invalid_configuration");
  }
  const limits = { ...SELECTION_DEFAULT_LIMITS, ...value } as SelectionLimits;
  if (!positiveInteger(limits.maxInputTokens) || !positiveInteger(limits.maxOutputTokens)
    || !positiveInteger(limits.maxTasks) || limits.maxTasks > SELECTION_HARD_LIMITS.maxTasks
    || !positiveInteger(limits.maxInputCharacters) || limits.maxInputCharacters > SELECTION_HARD_LIMITS.maxInputCharacters
    || limits.maxAttempts !== 1 && limits.maxAttempts !== 2) throw selectionError("invalid_configuration");
  return Object.freeze(limits);
}

export function selectionModelConfiguration(value: ProviderModelConfiguration): Readonly<ProviderModelConfiguration> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["provider", "model", "configurationId", "revision"])) throw selectionError("invalid_configuration");
  try { return resolveEmbeddingConfiguration(value); }
  catch { throw selectionError("invalid_configuration", "Selection model configuration is invalid."); }
}

export function resolveSelectionExecution(request: CapabilitySelectionRequest) {
  const limits = resolveSelectionLimits(request.limits);
  if (!request.client || typeof request.client.generateStructured !== "function" || typeof request.client.mock !== "boolean"
    || request.client.transportVersion !== undefined && (typeof request.client.transportVersion !== "string" || !request.client.transportVersion.trim() || request.client.transportVersion.length > 160)) {
    throw selectionError("invalid_configuration", "Selection requires an explicitly configured client and mock/live provenance.");
  }
  const model = selectionModelConfiguration(request.client.configuration);
  let execution;
  try {
    execution = resolveEmbeddingExecution({ limits: {
      maxInputTokens: limits.maxInputTokens, maxCharactersPerText: limits.maxInputCharacters,
      maxCharactersPerCall: limits.maxInputCharacters,
      ...(request.maxEstimatedCostPerCall === undefined ? {} : { maxEstimatedCostPerCall: request.maxEstimatedCostPerCall })
    }, budgetPolicy: request.budgetPolicy, estimateCost: request.estimateCost });
  } catch { throw selectionError("invalid_configuration", "Selection requires valid limits, provider-call budget, and any cost reservation ceiling."); }
  const fingerprint = fingerprintDiscoveryValue("selector", {
    promptVersion: SELECTION_PROMPT_VERSION, cardProjectionVersion: CANDIDATE_CARD_PROJECTION_VERSION,
    ...(request.client.transportVersion === undefined ? {} : { transportVersion: request.client.transportVersion }),
    outputSchemaVersion: SELECTION_OUTPUT_SCHEMA_VERSION, model, mock: request.client.mock, limits,
    ...(request.maxEstimatedCostPerCall === undefined ? {} : { maxEstimatedCostPerCall: request.maxEstimatedCostPerCall })
  });
  return Object.freeze({ limits, model, mock: request.client.mock, transportVersion: request.client.transportVersion, fingerprint, execution });
}

