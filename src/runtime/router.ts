import { isRestrictedCapability } from "../adapter-common.js";
import type { CapabilityManifest } from "../generated/manifest-types.js";
import type { LoadedCapabilityManifest, RiskTier } from "../types.js";
import type {
  AicfCapabilityRouter,
  AicfRuntimeContext,
  AicfRuntimeWarning,
  CapabilityRouteRequest,
  CapabilitySlice,
  CapabilitySliceItem,
  ManifestRegistry
} from "./types.js";

const riskRank: Record<RiskTier, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const maxCapabilitiesDefault = 8;
const maxCapabilitiesHardLimit = 20;

export class DefaultCapabilityRouter implements AicfCapabilityRouter {
  route(request: CapabilityRouteRequest): CapabilitySlice {
    const excluded: CapabilitySlice["excluded"] = [];
    const warnings: AicfRuntimeWarning[] = [];
    const maxCapabilities = Math.min(
      request.maxCapabilities ?? maxCapabilitiesDefault,
      maxCapabilitiesHardLimit
    );
    const maxRiskTier = request.maxRiskTier ?? request.builtContext.runtimeContext.autonomy.maxRiskTier;
    const candidates: CapabilitySliceItem[] = [];

    for (const loadedCapability of request.registry.capabilities) {
      const exclusion = exclusionReason(request, loadedCapability, maxRiskTier);
      if (exclusion) {
        excluded.push({
          capabilityId: loadedCapability.manifest.id,
          reason: exclusion
        });
        continue;
      }

      candidates.push(scoreCapability(request, loadedCapability));
    }

    const items = candidates
      .sort((left, right) => compareCapabilityItems(left, right, request.registry))
      .slice(0, maxCapabilities);

    for (const overflow of candidates.slice(maxCapabilities)) {
      excluded.push({
        capabilityId: overflow.capabilityId,
        reason: `Excluded by maxCapabilities ${maxCapabilities}.`
      });
    }

    if ((request.maxCapabilities ?? maxCapabilitiesDefault) > maxCapabilitiesHardLimit) {
      warnings.push({
        code: "max_capabilities_capped",
        message: `maxCapabilities was capped at ${maxCapabilitiesHardLimit}.`
      });
    }

    return {
      excluded,
      items,
      warnings
    };
  }
}

export function formatCapabilitySliceForModel(input: {
  registry: ManifestRegistry;
  slice: CapabilitySlice;
}): string {
  const lines = ["# Available capabilities"];

  for (const item of input.slice.items) {
    const loadedCapability = input.registry.capabilityById.get(item.capabilityId);
    if (!loadedCapability) {
      continue;
    }

    const capability = loadedCapability.manifest;
    lines.push(
      "",
      `## ${capability.id}`,
      `Purpose: ${capability.summary}`,
      `Use when: ${(capability.when_to_use ?? []).join(" ") || capability.model_description}`,
      `Inputs: ${inputFields(capability).join(", ") || "none"}`,
      `Safety: ${capability.risk_tier} risk; ${lifecycleSummary(capability)}.`,
      `Operations: ${item.exposedOperations.join(", ")}.`
    );
  }

  return lines.join("\n").trimEnd();
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

function scoreCapability(
  request: CapabilityRouteRequest,
  loadedCapability: LoadedCapabilityManifest
): CapabilitySliceItem {
  const capability = loadedCapability.manifest;
  const queryTokens = tokens([
    request.userInput.text,
    request.builtContext.runtimeContext.workflow?.currentEntityType,
    request.builtContext.runtimeContext.workflow?.currentEntityId,
    request.builtContext.runtimeContext.workflow?.workflowType
  ].filter(Boolean).join(" "));
  const capabilityText = [
    capability.id,
    capability.name,
    capability.summary,
    capability.model_description,
    capability.domain,
    ...(capability.when_to_use ?? []),
    ...(capability.tags ?? []),
    ...inputFields(capability)
  ].filter(Boolean).join(" ");
  const capabilityTokens = new Set(tokens(capabilityText));
  let score = 0;
  const reasons: string[] = [];

  for (const token of queryTokens) {
    if (capabilityTokens.has(token)) {
      score += 10;
    }
  }

  if (request.builtContext.runtimeContext.workflow?.currentEntityType) {
    const entityType = request.builtContext.runtimeContext.workflow.currentEntityType.toLowerCase();
    if (capabilityText.toLowerCase().includes(entityType)) {
      score += 5;
      reasons.push("Matches current workflow entity.");
    }
  }

  if (capability.domain && request.builtContext.runtimeContext.workflow?.workflowType?.toLowerCase().includes(capability.domain.toLowerCase())) {
    score += 3;
    reasons.push("Matches current workflow domain.");
  }

  if (score > 0) {
    reasons.push("Matched request text.");
  } else {
    reasons.push("Available after deterministic filters.");
  }

  return {
    capabilityId: capability.id,
    exposedOperations: capability.lifecycle.prepare ? ["select", "prepare"] : ["select"],
    reasons,
    score
  };
}

function compareCapabilityItems(
  left: CapabilitySliceItem,
  right: CapabilitySliceItem,
  registry: ManifestRegistry
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftRisk = registry.capabilityById.get(left.capabilityId)?.manifest.risk_tier ?? "critical";
  const rightRisk = registry.capabilityById.get(right.capabilityId)?.manifest.risk_tier ?? "critical";
  if (riskRank[leftRisk] !== riskRank[rightRisk]) {
    return riskRank[leftRisk] - riskRank[rightRisk];
  }

  return left.capabilityId.localeCompare(right.capabilityId);
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

function inputFields(capability: CapabilityManifest): string[] {
  const properties = capability.input_schema.properties;
  if (!isRecord(properties)) {
    return [];
  }

  return Object.keys(properties).sort();
}

function lifecycleSummary(capability: CapabilityManifest): string {
  if (capability.lifecycle.commit) {
    return "commit-capable and not exposed by default";
  }

  if (capability.lifecycle.prepare) {
    return "prepares only";
  }

  return "select/read only";
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_]+/).filter((token) => token.length > 1);
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

