import { hasOnlyKeys, isRecord, nonblank } from "./configuration.js";
import { DiscoveryError } from "./diagnostics.js";
import type { EmbeddingCallLimits, EmbeddingExecutionOptions, EmbeddingIndexLimits } from "./embedding-types.js";
import type { EmbeddingConfiguration } from "./types.js";

export function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function resolveEmbeddingConfiguration(value: EmbeddingConfiguration): Readonly<EmbeddingConfiguration> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["provider", "model", "configurationId", "revision", "dimensions"])
    || !nonblank(value.provider) || !nonblank(value.model) || !nonblank(value.configurationId)
    || (value.revision !== undefined && !nonblank(value.revision))
    || (value.dimensions !== undefined && !positiveInteger(value.dimensions))) throw invalidEmbeddingConfiguration();
  return Object.freeze({
    provider: value.provider, model: value.model, configurationId: value.configurationId,
    ...(value.revision === undefined ? {} : { revision: value.revision }),
    ...(value.dimensions === undefined ? {} : { dimensions: value.dimensions })
  });
}

export function resolveIndexLimits(value: EmbeddingIndexLimits): Readonly<EmbeddingIndexLimits> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["maxArtifactBytes", "maxEntries", "maxVectorDimension"])
    || !positiveInteger(value.maxArtifactBytes) || !positiveInteger(value.maxEntries)
    || !positiveInteger(value.maxVectorDimension)) throw invalidEmbeddingConfiguration();
  return Object.freeze({ ...value });
}

export function resolveEmbeddingExecution(value: EmbeddingExecutionOptions): Readonly<EmbeddingExecutionOptions> {
  if (!isRecord(value) || !hasOnlyKeys(value, ["limits", "budgetPolicy", "estimateCost"])
    || !isRecord(value.limits) || !hasOnlyKeys(value.limits,
      ["maxInputTokens", "maxCharactersPerText", "maxCharactersPerCall", "maxEstimatedCostPerCall"])
    || !positiveInteger(value.limits.maxInputTokens) || !positiveInteger(value.limits.maxCharactersPerText)
    || !positiveInteger(value.limits.maxCharactersPerCall)
    || (value.limits.maxEstimatedCostPerCall !== undefined && !nonnegative(value.limits.maxEstimatedCostPerCall))
    || !isRecord(value.budgetPolicy) || !nonblank(value.budgetPolicy.id) || !isRecord(value.budgetPolicy.scope)
    || !["global", "provider", "model", "capability", "domain", "risk_tier", "tenant", "autonomy_tier"].includes(value.budgetPolicy.scope.type as string)
    || (value.estimateCost !== undefined && typeof value.estimateCost !== "function")) throw invalidEmbeddingConfiguration();
  const policy = value.budgetPolicy;
  if (!hasOnlyKeys(policy, ["id", "scope", "mode", "maxEstimatedCostPerRun", "maxInputTokensPerRun",
    "maxOutputTokensPerRun", "maxProviderCallsPerRun", "maxRetriesPerRun", "maxRuntimeMsPerRun", "maxToolCallsPerRun"])
    || (policy.mode !== undefined && policy.mode !== "hard" && policy.mode !== "warn")
    || !Number.isSafeInteger(policy.maxProviderCallsPerRun) || (policy.maxProviderCallsPerRun ?? -1) < 0) throw invalidEmbeddingConfiguration();
  for (const [key, amount] of Object.entries(policy)) {
    if (!key.startsWith("max")) continue;
    if (!nonnegative(amount) || (key !== "maxEstimatedCostPerRun" && !Number.isSafeInteger(amount))) throw invalidEmbeddingConfiguration();
  }
  const scopeFields: Record<string, string[]> = {
    global: [], provider: ["providerId"], model: ["providerId", "model"], capability: ["capabilityId"],
    domain: ["domain"], risk_tier: ["riskTier"], tenant: ["tenantId"], autonomy_tier: ["autonomyTier"]
  };
  const fields = scopeFields[policy.scope.type]!;
  if (!hasOnlyKeys(policy.scope, ["type", ...fields]) || fields.some(key => !nonblank((policy.scope as unknown as Record<string, unknown>)[key]))
    || policy.scope.type === "risk_tier" && !["none", "low", "medium", "high", "critical"].includes(policy.scope.riskTier)
    || policy.scope.type === "autonomy_tier" && !["A0", "A1", "A2", "A3", "A4", "A5"].includes(policy.scope.autonomyTier)
    || (policy.maxEstimatedCostPerRun !== undefined && value.limits.maxEstimatedCostPerCall === undefined)) throw invalidEmbeddingConfiguration();
  return Object.freeze({
    limits: Object.freeze({ ...value.limits }),
    budgetPolicy: Object.freeze({ ...policy, scope: Object.freeze({ ...policy.scope }) }),
    ...(value.estimateCost ? { estimateCost: value.estimateCost } : {})
  });
}

export function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function checkEmbeddingTexts(texts: readonly string[], limits: EmbeddingCallLimits): void {
  let characters = 0;
  for (const text of texts) {
    if (typeof text !== "string" || text.length > limits.maxCharactersPerText) throw inputLimit();
    characters += text.length;
    if (characters > limits.maxCharactersPerCall) throw inputLimit();
  }
}

export function invalidEmbeddingConfiguration(): DiscoveryError {
  return new DiscoveryError({ code: "invalid_configuration", message: "Embedding configuration, limits, and provider-call budget must be explicit and valid." });
}

export function inputLimit(): DiscoveryError {
  return new DiscoveryError({ code: "input_limit_exceeded", message: "Embedding input or artifact exceeds the configured limits." });
}
