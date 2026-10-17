import { filterEligibleCapabilities } from "../runtime/eligibility.js";
import type { CapabilityRouteRequest } from "../runtime/types.js";
import { ordinalCompare } from "./corpus.js";
import { fingerprintDiscoveryValue } from "./fingerprint.js";

export function captureEligibility(request: CapabilityRouteRequest) {
  const result = filterEligibleCapabilities(request);
  const sorted = (values: string[] | undefined) => values === undefined ? null : [...new Set(values)].sort(ordinalCompare);
  return {
    ...result,
    fingerprint: fingerprintDiscoveryValue("eligibility", {
      capabilities: result.eligible.map(({ manifest }) => ({
        capabilityId: manifest.id, capabilityVersion: manifest.version,
        exposedOperations: manifest.lifecycle.prepare ? ["select", "prepare"] as const : ["select"] as const
      })).sort((left, right) => ordinalCompare(left.capabilityId, right.capabilityId)),
      policy: {
        allowedCapabilityTypes: sorted(request.allowedCapabilityTypes), allowedDomains: sorted(request.allowedDomains),
        includeCapabilityIds: sorted(request.includeCapabilityIds), excludeCapabilityIds: sorted(request.excludeCapabilityIds),
        maxRiskTier: request.maxRiskTier ?? request.builtContext.runtimeContext.autonomy.maxRiskTier,
        includeRestricted: request.includeRestricted ?? false, includeDraft: request.includeDraft ?? false,
        includeExperimental: request.includeExperimental ?? false, includeDeprecated: request.includeDeprecated ?? false,
        includeDisabledForTests: request.includeDisabledForTests ?? false
      }
    })
  };
}
