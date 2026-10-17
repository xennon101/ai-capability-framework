import type { ProviderStageUsage, ProviderUsage, ProviderUsageTotals, ModelUsage, UsageQuantity } from "./provider-types.js";
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function freezeProviderValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeProviderValue(child);
    Object.freeze(value);
  }
  return value;
}
const deepFreeze = freezeProviderValue;
export const USAGE_QUANTITIES = ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens", "estimatedCost"] as const;

export function knownUsage(value: unknown): ModelUsage {
  if (!value || typeof value !== "object") return {};
  const result: ModelUsage = {};
  for (const key of USAGE_QUANTITIES) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor && nonnegative(descriptor.value)
      && (key === "estimatedCost" || Number.isSafeInteger(descriptor.value))) result[key] = descriptor.value;
  }
  return result;
}

export function validReportedUsage(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Reflect.ownKeys(value).every(key => {
    if (typeof key !== "string" || !(USAGE_QUANTITIES as readonly string[]).includes(key)) return false;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property && "value" in property && nonnegative(property.value)
      && (key === "estimatedCost" || Number.isSafeInteger(property.value));
  });
}

export function ownValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property && "value" in property ? property.value : undefined;
}

export function usageQuantities(usage: ModelUsage, noAttempt = false): Pick<ProviderUsageTotals, typeof USAGE_QUANTITIES[number]> {
  const result = {} as Pick<ProviderUsageTotals, typeof USAGE_QUANTITIES[number]>;
  for (const key of USAGE_QUANTITIES) result[key] = usage[key] !== undefined
    ? { total: usage[key]!, knownSubtotal: usage[key]!, complete: true }
    : noAttempt ? { total: 0, knownSubtotal: 0, complete: true } : { total: null, knownSubtotal: 0, complete: false };
  return result;
}

export function aggregateProviderUsage(stages: readonly ProviderStageUsage[], elapsedMs: number): ProviderUsage {
  const totals: ProviderUsageTotals = {
    providerAttempts: 0, completedResponses: 0, retryAttempts: 0, repairAttempts: 0, elapsedMs,
    ...usageQuantities({}, true)
  };
  for (const stage of stages) {
    for (const key of ["providerAttempts", "completedResponses", "retryAttempts", "repairAttempts"] as const) totals[key] += stage[key];
    for (const key of USAGE_QUANTITIES) {
      const knownSubtotal = totals[key].knownSubtotal + stage[key].knownSubtotal;
      const complete = totals[key].complete && stage[key].complete && Number.isFinite(knownSubtotal);
      const quantity: UsageQuantity = complete
        ? { total: knownSubtotal, knownSubtotal, complete: true }
        : { total: null, knownSubtotal: Number.isFinite(knownSubtotal) ? knownSubtotal : totals[key].knownSubtotal, complete: false };
      totals[key] = quantity;
    }
  }
  return deepFreeze({ stages: [...stages], totals });
}
