import { filterEligibleCapabilities } from "./eligibility.js";
import type { CapabilityManifest } from "../generated/manifest-types.js";
import type { LoadedCapabilityManifest, RiskTier } from "../types.js";
import type {
  AicfCapabilityRouter,
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
    const { eligible, excluded } = filterEligibleCapabilities(request);
    const warnings: AicfRuntimeWarning[] = [];
    const maxCapabilities = Math.min(
      request.maxCapabilities ?? maxCapabilitiesDefault,
      maxCapabilitiesHardLimit
    );
    const candidates: CapabilitySliceItem[] = [];

    for (const loadedCapability of eligible) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
