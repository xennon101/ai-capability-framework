import type { ManifestRegistry } from "../types.js";
import {
  hasEvalCoverage,
  hasRedTeamCoverage,
  hasWriteOrExternalSideEffect,
  riskAtLeast,
  sortedUnique
} from "./helpers.js";
import type { CapabilityImpactReport, ImpactAnalysisOptions, ImpactCoverageGap } from "./types.js";

const providerTargets = [
  "openai",
  "anthropic",
  "gemini",
  "ai-sdk",
  "langchain",
  "mcp",
  "semantic-kernel"
];

export function analyzeCapabilityImpact(
  registry: ManifestRegistry,
  capabilityId: string,
  options: ImpactAnalysisOptions = {}
): CapabilityImpactReport {
  const capability = registry.capabilityById.get(capabilityId)?.manifest;
  if (!capability) {
    return {
      affectedCapabilities: [],
      affectedEntities: [],
      affectedEvalSuites: [],
      affectedPolicies: [],
      affectedProviders: [],
      affectedSecurityPacks: [],
      affectedTenants: options.affectedTenants,
      affectedTraces: options.affectedTraces,
      capabilityId,
      missingCoverage: [{
        code: "capability_unknown",
        message: `Capability "${capabilityId}" is not loaded.`,
        severity: "blocking"
      }]
    };
  }

  const affectedCapabilities = registry.capabilities
    .map((entry) => entry.manifest)
    .filter((entry) => entry.id !== capabilityId)
    .filter((entry) => entry.lifecycle.commit_capability_id === capabilityId || capability.lifecycle.commit_capability_id === entry.id)
    .map((entry) => entry.id);

  const affectedEntities = registry.entities
    .map((entry) => entry.manifest)
    .filter((entity) => entity.allowed_actions.includes(capabilityId)
      || entity.lookup.primary_capability === capabilityId
      || (entity.relationships ?? []).some((relationship) => relationship.lookup_capability === capabilityId))
    .map((entity) => entity.id);

  const affectedEvalSuites = registry.evals
    .map((entry) => entry.manifest)
    .filter((evalCase) => evalCase.capability_under_test === capabilityId)
    .map((evalCase) => evalCase.id);

  const affectedPolicies = [
    ...capability.authorization.permissions.map((permission) => `permission:${permission}`),
    ...(capability.policy.approval_required ? ["approval:required"] : []),
    ...(capability.policy.approval_required_if ?? []).map((rule) => `approval_if:${rule.rule}`),
    ...(capability.policy.deny_if ?? []).map((rule) => `deny_if:${rule.rule}`)
  ];

  return {
    affectedCapabilities: sortedUnique(affectedCapabilities),
    affectedEntities: sortedUnique(affectedEntities),
    affectedEvalSuites: sortedUnique(affectedEvalSuites),
    affectedPolicies: sortedUnique(affectedPolicies),
    affectedProviders: affectedProviderTargets(capability),
    affectedSecurityPacks: affectedSecurityPacks(capability),
    affectedTenants: options.affectedTenants,
    affectedTraces: options.affectedTraces,
    capabilityId,
    missingCoverage: missingCoverage(capability, affectedEntities, affectedEvalSuites)
  };
}

function affectedProviderTargets(capability: NonNullable<ReturnType<ManifestRegistry["capabilityById"]["get"]>>["manifest"]): string[] {
  if (capability.lifecycle.commit || capability.capability_type === "write_commit") {
    return ["semantic-kernel"];
  }

  if (capability.lifecycle.prepare || capability.side_effects.reads_data || capability.capability_type === "read_data") {
    return providerTargets;
  }

  return ["openai", "anthropic", "gemini", "ai-sdk", "langchain", "mcp"];
}

function affectedSecurityPacks(capability: NonNullable<ReturnType<ManifestRegistry["capabilityById"]["get"]>>["manifest"]): string[] {
  if (riskAtLeast(capability.risk_tier, "high")) {
    return ["capability-security-baseline"];
  }
  return [];
}

function missingCoverage(
  capability: NonNullable<ReturnType<ManifestRegistry["capabilityById"]["get"]>>["manifest"],
  affectedEntities: string[],
  affectedEvalSuites: string[]
): ImpactCoverageGap[] {
  const gaps: ImpactCoverageGap[] = [];
  if (affectedEntities.length === 0) {
    gaps.push({
      code: "entity_coverage_missing",
      message: "No entity manifest directly references this capability.",
      severity: "warning"
    });
  }
  if (!hasEvalCoverage(capability) && affectedEvalSuites.length === 0) {
    gaps.push({
      code: "eval_coverage_missing",
      message: "No eval coverage was found for this capability.",
      severity: riskAtLeast(capability.risk_tier, "medium") ? "blocking" : "warning"
    });
  }
  if ((riskAtLeast(capability.risk_tier, "high") || hasWriteOrExternalSideEffect(capability)) && !hasRedTeamCoverage(capability)) {
    gaps.push({
      code: "red_team_coverage_missing",
      message: "High-risk or side-effecting capabilities should include red-team coverage.",
      severity: riskAtLeast(capability.risk_tier, "high") ? "blocking" : "warning"
    });
  }
  if (capability.lifecycle.prepare && capability.lifecycle.approve && !capability.lifecycle.commit_capability_id) {
    gaps.push({
      code: "commit_link_missing",
      message: "Approval-capable prepare capability does not declare lifecycle.commit_capability_id.",
      severity: "warning"
    });
  }

  return gaps;
}
