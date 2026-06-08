import type { CapabilityManifest, LoadedCapabilityManifest, ManifestRegistry, RiskTier } from "../types.js";
import type { CapabilityLifecycleStatus, GovernanceReason, GovernanceRequirement, GovernanceSeverity } from "./types.js";

export const riskRank: Record<RiskTier, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function riskAtLeast(left: RiskTier, right: RiskTier): boolean {
  return riskRank[left] >= riskRank[right];
}

export function maxRisk(left: RiskTier, right: RiskTier): RiskTier {
  return riskRank[left] >= riskRank[right] ? left : right;
}

export function governanceReason(code: string, message: string, severity: GovernanceSeverity = "blocking"): GovernanceReason {
  return {
    code,
    message,
    severity
  };
}

export function governanceRequirement(code: string, message: string, severity: GovernanceSeverity = "blocking"): GovernanceRequirement {
  return {
    code,
    message,
    severity
  };
}

export function hasOwner(capability: CapabilityManifest): boolean {
  return Boolean(capability.owner?.team && capability.owner.contact);
}

export function hasWriteOrExternalSideEffect(capability: CapabilityManifest): boolean {
  const sideEffects = capability.side_effects;
  return sideEffects.writes_data
    || sideEffects.creates_records
    || sideEffects.updates_records
    || sideEffects.deletes_records
    || sideEffects.sends_external_messages
    || sideEffects.charges_money
    || sideEffects.refunds_money
    || sideEffects.changes_permissions
    || sideEffects.triggers_external_workflow
    || sideEffects.irreversible;
}

export function hasDestructiveSideEffect(capability: CapabilityManifest): boolean {
  const sideEffects = capability.side_effects;
  return sideEffects.deletes_records
    || sideEffects.changes_permissions
    || sideEffects.irreversible;
}

export function hasMoneySideEffect(capability: CapabilityManifest): boolean {
  return capability.side_effects.charges_money || capability.side_effects.refunds_money;
}

export function hasExternalSideEffect(capability: CapabilityManifest): boolean {
  return capability.side_effects.sends_external_messages || capability.side_effects.triggers_external_workflow;
}

export function hasEvalCoverage(capability: CapabilityManifest): boolean {
  return (capability.evals?.golden?.length ?? 0) + (capability.evals?.red_team?.length ?? 0) > 0;
}

export function hasRedTeamCoverage(capability: CapabilityManifest): boolean {
  return (capability.evals?.red_team?.length ?? 0) > 0;
}

export function mapManifestStatus(status: CapabilityManifest["status"]): CapabilityLifecycleStatus {
  switch (status) {
    case "active":
      return "production";
    case "deprecated":
      return "deprecated";
    case "disabled":
      return "disabled";
    case "draft":
      return "draft";
    case "experimental":
      return "review";
  }
}

export function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function loadedCapabilities(registry: ManifestRegistry): LoadedCapabilityManifest[] {
  return registry.capabilities.slice().sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}
