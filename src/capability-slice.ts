import { decideCapability } from "./decision.js";
import { isRestrictedCapability, selectContextForCapability } from "./adapter-common.js";
import type {
  AdapterExcludedCapability,
  AicfDiagnostic,
  CapabilitySlice,
  DecisionOptions,
  DecisionReason,
  LoadedCapabilityManifest,
  ManifestRegistry,
  SelectCapabilitySliceInput
} from "./types.js";

export function selectCapabilitySlice(input: SelectCapabilitySliceInput): CapabilitySlice {
  const diagnostics: AicfDiagnostic[] = [];
  const excluded: AdapterExcludedCapability[] = [];
  const capabilities: LoadedCapabilityManifest[] = [];
  const entityCapabilityIds = entityAllowedCapabilityIds(input.registry, input.entities);
  const options = decisionOptions(input);

  for (const loadedCapability of input.registry.capabilities) {
    const capability = loadedCapability.manifest;
    const staticReason = staticFilterReason(input, loadedCapability, entityCapabilityIds);
    if (staticReason) {
      diagnostics.push(...staticReason.diagnostics);
      excluded.push(staticReason);
      continue;
    }

    if (isRestrictedCapability(capability) && !input.includeRestricted) {
      const capabilityDiagnostics = [capabilityExcludedDiagnostic(
        loadedCapability,
        "Capability is restricted and was not selected for the slice.",
        { restricted: true }
      )];
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: "restricted"
      });
      continue;
    }

    const decision = decideCapability(input.registry, {
      capabilityId: capability.id,
      context: {
        ...selectContextForCapability(capability, input.context),
        allowedRiskTiers: input.allowedRiskTiers ?? input.context.allowedRiskTiers,
        riskCeiling: input.riskCeiling ?? input.context.riskCeiling
      },
      operation: "select"
    }, options);

    if (decision.status !== "allowed") {
      const capabilityDiagnostics = decision.reasons.map((reason) => capabilityExcludedDiagnostic(
        loadedCapability,
        `Capability was not selected: ${reason.message}`,
        reason
      ));
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: capability.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: excludedReasonFromDecision(decision.reasons)
      });
      continue;
    }

    capabilities.push(loadedCapability);
  }

  if (input.maxCapabilities !== undefined && capabilities.length > input.maxCapabilities) {
    const overflow = capabilities.splice(input.maxCapabilities);
    for (const loadedCapability of overflow) {
      const capabilityDiagnostics = [capabilityExcludedDiagnostic(
        loadedCapability,
        `Capability was excluded because maxCapabilities is ${input.maxCapabilities}.`,
        { maxCapabilities: input.maxCapabilities }
      )];
      diagnostics.push(...capabilityDiagnostics);
      excluded.push({
        capabilityId: loadedCapability.manifest.id,
        diagnostics: capabilityDiagnostics,
        path: loadedCapability.path,
        reason: "decision_denied"
      });
    }
  }

  return {
    capabilities,
    diagnostics,
    excluded,
    registry: input.registry
  };
}

function staticFilterReason(
  input: SelectCapabilitySliceInput,
  loadedCapability: LoadedCapabilityManifest,
  entityCapabilityIds: Set<string> | null
): AdapterExcludedCapability | null {
  const capability = loadedCapability.manifest;

  if (input.capabilityIds && !input.capabilityIds.includes(capability.id)) {
    return excludedByFilter(loadedCapability, "Capability ID was not requested.", { capabilityIds: input.capabilityIds });
  }

  if (input.domains && (!capability.domain || !input.domains.includes(capability.domain))) {
    return excludedByFilter(loadedCapability, "Capability domain was not requested.", { domains: input.domains });
  }

  if (entityCapabilityIds && !entityCapabilityIds.has(capability.id)) {
    return excludedByFilter(loadedCapability, "Capability is not allowed by the requested entities.", { entities: input.entities });
  }

  if (input.tags && !input.tags.some((tag) => capability.tags?.includes(tag))) {
    return excludedByFilter(loadedCapability, "Capability tags did not match requested tags.", { tags: input.tags });
  }

  if (input.allowedCapabilityTypes && !input.allowedCapabilityTypes.includes(capability.capability_type)) {
    return excludedByFilter(loadedCapability, "Capability type was not requested.", { allowedCapabilityTypes: input.allowedCapabilityTypes });
  }

  return null;
}

function entityAllowedCapabilityIds(
  registry: ManifestRegistry,
  entities: string[] | undefined
): Set<string> | null {
  if (!entities) {
    return null;
  }

  const allowed = new Set<string>();
  for (const entityId of entities) {
    const entity = registry.entityById.get(entityId);
    for (const capabilityId of entity?.manifest.allowed_actions ?? []) {
      allowed.add(capabilityId);
    }

    for (const relationship of entity?.manifest.relationships ?? []) {
      if (relationship.lookup_capability) {
        allowed.add(relationship.lookup_capability);
      }
    }
  }

  return allowed;
}

function excludedByFilter(
  loadedCapability: LoadedCapabilityManifest,
  message: string,
  details: unknown
): AdapterExcludedCapability {
  const diagnostics = [capabilityExcludedDiagnostic(loadedCapability, message, details)];
  return {
    capabilityId: loadedCapability.manifest.id,
    diagnostics,
    path: loadedCapability.path,
    reason: "decision_denied"
  };
}

function capabilityExcludedDiagnostic(
  loadedCapability: LoadedCapabilityManifest,
  message: string,
  details?: unknown
): AicfDiagnostic {
  return {
    code: "capability_excluded",
    details,
    id: loadedCapability.manifest.id,
    kind: "capability",
    message,
    path: loadedCapability.path
  };
}

function decisionOptions(input: SelectCapabilitySliceInput): DecisionOptions {
  return {
    includeDeprecated: input.includeDeprecated,
    includeDisabledForTests: input.includeDisabledForTests,
    includeDraft: input.includeDraft,
    includeExperimental: input.includeExperimental
  };
}

function excludedReasonFromDecision(reasons: DecisionReason[]): AdapterExcludedCapability["reason"] {
  if (reasons.some((reason) => reason.code === "status_disabled")) return "status_disabled";
  if (reasons.some((reason) => reason.code === "status_deprecated")) return "status_deprecated";
  if (reasons.some((reason) => reason.code === "status_draft")) return "status_draft";
  if (reasons.some((reason) => reason.code === "status_experimental")) return "status_experimental";
  if (reasons.some((reason) => reason.code === "risk_tier_exceeded")) return "risk_tier_exceeded";
  if (reasons.some((reason) => reason.code === "risk_tier_not_allowed")) return "risk_tier_not_allowed";
  return "decision_denied";
}
