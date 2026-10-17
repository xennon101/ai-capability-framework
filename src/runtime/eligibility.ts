import { isRestrictedCapability } from "../adapter-common.js";
import { readOnlyBlocks } from "../controls/index.js";
import type { CapabilityManifest } from "../generated/manifest-types.js";
import type { LoadedCapabilityManifest, RiskTier } from "../types.js";
import type { AicfRuntimeContext, CapabilityEligibilityResult, CapabilityRouteRequest } from "./types.js";

const riskRank: Record<RiskTier, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

/** Enumerates the full eligible registry without scoring or count truncation. */
export function filterEligibleCapabilities(request: CapabilityRouteRequest): CapabilityEligibilityResult {
  const eligible: LoadedCapabilityManifest[] = [];
  const excluded: CapabilityEligibilityResult["excluded"] = [];
  const maxRiskTier = request.maxRiskTier ?? request.builtContext.runtimeContext.autonomy.maxRiskTier;
  for (const capability of request.registry.capabilities) {
    const reason = exclusionReason(request, capability, maxRiskTier);
    if (reason) excluded.push({ capabilityId: capability.manifest.id, reason });
    else eligible.push(capability);
  }
  return { eligible, excluded };
}

function exclusionReason(
  request: CapabilityRouteRequest,
  loadedCapability: LoadedCapabilityManifest,
  maxRiskTier: Exclude<RiskTier, "none">
): string | null {
  const capability = loadedCapability.manifest;

  if (request.includeCapabilityIds && !request.includeCapabilityIds.includes(capability.id)) {
    return "Capability was not explicitly included.";
  }

  if (request.excludeCapabilityIds?.includes(capability.id)) {
    return "Capability was explicitly excluded.";
  }

  const statusReason = statusExclusionReason(request, capability);
  if (statusReason) {
    return statusReason;
  }

  if (riskRank[capability.risk_tier] > riskRank[maxRiskTier]) {
    return `Capability risk tier ${capability.risk_tier} exceeds ${maxRiskTier}.`;
  }

  if (isRestrictedCapability(capability) && !request.includeRestricted) {
    return "Restricted side-effect capability was excluded.";
  }

  const controlsReason = controlsExclusionReason(request, loadedCapability);
  if (controlsReason) {
    return controlsReason;
  }

  const contextReason = requiredContextReason(capability, request.builtContext.runtimeContext);
  if (contextReason) {
    return contextReason;
  }

  const permissionReason = permissionExclusionReason(request, capability);
  if (permissionReason) {
    return permissionReason;
  }

  if (request.allowedDomains && (!capability.domain || !request.allowedDomains.includes(capability.domain))) {
    return "Capability domain was not allowed.";
  }

  if (request.allowedCapabilityTypes && !request.allowedCapabilityTypes.includes(capability.capability_type)) {
    return "Capability type was not allowed.";
  }

  return null;
}

function controlsExclusionReason(
  request: CapabilityRouteRequest,
  loadedCapability: LoadedCapabilityManifest
): string | null {
  if (!request.controls) {
    return null;
  }

  const decision = request.controls.evaluate({
    capability: loadedCapability,
    capabilityId: loadedCapability.manifest.id,
    domain: loadedCapability.manifest.domain,
    operation: "export",
    registry: request.registry,
    riskTier: loadedCapability.manifest.risk_tier,
    runtimeContext: request.builtContext.runtimeContext
  });

  if (decision.status === "denied") {
    return decision.reasons[0]?.message ?? "Capability was denied by runtime controls.";
  }

  if (decision.status === "read_only" && readOnlyBlocks({
    capability: loadedCapability,
    capabilityId: loadedCapability.manifest.id,
    operation: "export",
    runtimeContext: request.builtContext.runtimeContext
  })) {
    return decision.reasons[0]?.message ?? "Read-only controls exclude this capability.";
  }

  return null;
}

function statusExclusionReason(
  request: CapabilityRouteRequest,
  capability: CapabilityManifest
): string | null {
  switch (capability.status) {
    case "active":
      return null;
    case "disabled":
      return request.includeDisabledForTests ? null : "Disabled capability was excluded.";
    case "deprecated":
      return request.includeDeprecated ? null : "Deprecated capability was excluded.";
    case "draft":
      return request.includeDraft ? null : "Draft capability was excluded.";
    case "experimental":
      return request.includeExperimental ? null : "Experimental capability was excluded.";
  }
}

function requiredContextReason(
  capability: CapabilityManifest,
  context: AicfRuntimeContext
): string | null {
  if (capability.authorization.requires_user_context && !hasText(context.subject.userId)) {
    return "Capability requires user context.";
  }

  if (capability.authorization.tenant_scoped && !hasText(context.account.tenantId)) {
    return "Capability requires tenant context.";
  }

  if (!hasText(context.account.accountId)) {
    return "Runtime account context is required.";
  }

  return null;
}

function permissionExclusionReason(
  request: CapabilityRouteRequest,
  capability: CapabilityManifest
): string | null {
  const override = request.capabilityPermissions?.[capability.id];
  if (override && !override.allowed) {
    return override.reason ?? "Capability permission adapter denied access.";
  }

  const permissionSet = new Set([
    ...request.builtContext.runtimeContext.subject.permissions,
    ...(override?.permissions ?? [])
  ]);
  const missingPermission = capability.authorization.permissions.find((permission) => !permissionSet.has(permission));
  return missingPermission ? `Missing permission ${missingPermission}.` : null;
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
