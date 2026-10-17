import { DiscoveryError } from "./diagnostics.js";
import { DISCOVERY_DEFAULT_LIMITS, DISCOVERY_HARD_LIMITS } from "./versions.js";
import type { DiscoveryConfiguration, ResolvedDiscoveryConfiguration, ResolvedLexicalDiscoveryConfiguration } from "./types.js";

export const HYBRID_WEIGHT_TOLERANCE = 1e-12;

export function resolveDiscoveryConfiguration(value: DiscoveryConfiguration): ResolvedDiscoveryConfiguration {
  if (isRecord(value) && value.mode === "hybrid") {
    if (!hasOnlyKeys(value, ["mode", "policyVersion", "limits", "aliasWeight", "minRetrievalScore", "weights", "failurePolicy"])
      || !isRecord(value.weights) || !hasOnlyKeys(value.weights, ["semantic", "lexical"])
      || !unitScore(value.weights.semantic) || !unitScore(value.weights.lexical)
      || Math.abs(value.weights.semantic + value.weights.lexical - 1) > HYBRID_WEIGHT_TOLERANCE
      || value.failurePolicy !== "unavailable" && value.failurePolicy !== "lexical_fallback") {
      throw new DiscoveryError({ code: "invalid_configuration", message: "Hybrid discovery requires explicit unit weights and a failure policy." });
    }
    const lexical = resolveLexicalConfiguration({
      mode: "lexical", policyVersion: value.policyVersion,
      limits: value.limits, aliasWeight: value.aliasWeight, minRetrievalScore: value.minRetrievalScore
    });
    return Object.freeze({ ...lexical, mode: "hybrid", weights: Object.freeze({ ...value.weights }), failurePolicy: value.failurePolicy });
  }
  return resolveLexicalConfiguration(value);
}

export function lexicalConfiguration(value: ResolvedDiscoveryConfiguration): ResolvedLexicalDiscoveryConfiguration {
  return Object.freeze({ mode: "lexical", policyVersion: value.policyVersion, limits: value.limits,
    aliasWeight: value.aliasWeight, minRetrievalScore: value.minRetrievalScore });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key));
}

export function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function unitScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function resolveLexicalConfiguration(value: DiscoveryConfiguration): ResolvedLexicalDiscoveryConfiguration {
  const invalid = () => new DiscoveryError({
    code: "invalid_configuration", message: "Discovery requires a valid, explicit lexical configuration."
  });
  if (!isRecord(value) || !hasOnlyKeys(value, ["mode", "policyVersion", "limits", "aliasWeight", "minRetrievalScore"])
    || value.mode !== "lexical" || !nonblank(value.policyVersion)) throw invalid();
  if (value.limits !== undefined && (!isRecord(value.limits)
    || !hasOnlyKeys(value.limits, Object.keys(DISCOVERY_DEFAULT_LIMITS)))) throw invalid();
  const limits = { ...DISCOVERY_DEFAULT_LIMITS, ...value.limits };
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const minimum = key === "aliasDiversitySlots" ? 0 : 1;
    if (!Number.isInteger(limits[key]) || limits[key] < minimum || limits[key] > DISCOVERY_HARD_LIMITS[key]) {
      throw invalid();
    }
  }
  if (limits.aliasDiversitySlots >= limits.maxCandidates
    || (value.aliasWeight !== undefined && !unitScore(value.aliasWeight))
    || (value.minRetrievalScore !== undefined && !unitScore(value.minRetrievalScore))) throw invalid();
  return Object.freeze({
    mode: "lexical", policyVersion: value.policyVersion, limits: Object.freeze(limits),
    aliasWeight: value.aliasWeight ?? 0, minRetrievalScore: value.minRetrievalScore ?? 0
  });
}
