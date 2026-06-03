import path from "node:path";
import type {
  AicfDiagnostic,
  LoadedCapabilityManifest,
  LoadedEntityManifest,
  LoadedEvalCase,
  LoadedManifest,
  ManifestRegistry,
  RegistryInspection
} from "./types.js";

export function buildRegistry(manifests: LoadedManifest[]): ManifestRegistry {
  const capabilities = manifests.filter(isCapability);
  const entities = manifests.filter(isEntity);
  const evals = manifests.filter(isEval);
  const capabilityById = new Map(capabilities.map((entry) => [entry.manifest.id, entry]));
  const entityById = new Map(entities.map((entry) => [entry.manifest.id, entry]));
  const evalById = new Map(evals.map((entry) => [entry.manifest.id, entry]));
  const warnings = buildWarnings(entities, evals, capabilityById);

  return {
    capabilities,
    capabilityById,
    entities,
    entityById,
    evalById,
    evals,
    warnings
  };
}

export function inspectRegistry(registry: ManifestRegistry): RegistryInspection {
  const evalCoverage = registry.capabilities
    .map((entry) => ({
      capabilityId: entry.manifest.id,
      golden: entry.manifest.evals?.golden?.length ?? 0,
      redTeam: entry.manifest.evals?.red_team?.length ?? 0
    }))
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));

  return {
    capabilitiesByRisk: groupCapabilities(registry.capabilities, "risk_tier"),
    capabilitiesByType: groupCapabilities(registry.capabilities, "capability_type"),
    counts: {
      capabilities: registry.capabilities.length,
      entities: registry.entities.length,
      evals: registry.evals.length,
      manifests: registry.capabilities.length + registry.entities.length + registry.evals.length
    },
    entities: registry.entities.map((entry) => entry.manifest.id).sort(),
    evalCoverage,
    warnings: registry.warnings
  };
}

export function formatInspection(inspection: RegistryInspection): string {
  const lines = [
    "AICF Registry",
    `Manifests: ${inspection.counts.manifests} (${inspection.counts.capabilities} capabilities, ${inspection.counts.entities} entities, ${inspection.counts.evals} evals)`,
    "",
    "Capabilities by type:",
    ...formatGroups(inspection.capabilitiesByType),
    "",
    "Capabilities by risk:",
    ...formatGroups(inspection.capabilitiesByRisk),
    "",
    "Entities:",
    ...formatList(inspection.entities),
    "",
    "Eval coverage:",
    ...inspection.evalCoverage.map((coverage) => `- ${coverage.capabilityId}: golden ${coverage.golden}, red_team ${coverage.redTeam}`),
    "",
    "Warnings:",
    ...formatWarnings(inspection.warnings)
  ];

  return `${lines.join("\n")}\n`;
}

function buildWarnings(
  entities: LoadedEntityManifest[],
  evals: LoadedEvalCase[],
  capabilityById: Map<string, LoadedCapabilityManifest>
): AicfDiagnostic[] {
  const warnings: AicfDiagnostic[] = [];

  for (const entity of entities) {
    for (const capabilityId of entity.manifest.allowed_actions) {
      if (!capabilityById.has(capabilityId)) {
        warnings.push({
          code: "unknown_allowed_action",
          id: entity.manifest.id,
          kind: "entity",
          message: `Allowed action "${capabilityId}" does not match a loaded capability.`,
          path: entity.path
        });
      }
    }

    // Lookup capabilities can be owned by another manifest bundle. Phase 2 only
    // warns on action/eval references that affect this loaded registry.
  }

  for (const evalCase of evals) {
    const capabilityId = evalCase.manifest.capability_under_test;
    if (capabilityId && !capabilityById.has(capabilityId)) {
      warnings.push({
        code: "unknown_capability_under_test",
        id: evalCase.manifest.id,
        kind: "eval",
        message: `Capability under test "${capabilityId}" does not match a loaded capability.`,
        path: evalCase.path
      });
    }
  }

  return warnings.sort((left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
}

function groupCapabilities(
  capabilities: LoadedCapabilityManifest[],
  key: "capability_type" | "risk_tier"
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const capability of capabilities) {
    const group = capability.manifest[key];
    groups[group] ??= [];
    groups[group].push(capability.manifest.id);
  }

  for (const ids of Object.values(groups)) {
    ids.sort();
  }

  return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)));
}

function formatGroups(groups: Record<string, string[]>): string[] {
  const entries = Object.entries(groups);
  if (entries.length === 0) {
    return ["- none"];
  }

  return entries.map(([group, ids]) => `- ${group}: ${ids.join(", ")}`);
}

function formatList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- none"];
}

function formatWarnings(warnings: AicfDiagnostic[]): string[] {
  if (warnings.length === 0) {
    return ["- none"];
  }

  return warnings.map((warning) => `- ${warning.path}: ${warning.message}`);
}

function isCapability(manifest: LoadedManifest): manifest is LoadedCapabilityManifest {
  return manifest.kind === "capability";
}

function isEntity(manifest: LoadedManifest): manifest is LoadedEntityManifest {
  return manifest.kind === "entity";
}

function isEval(manifest: LoadedManifest): manifest is LoadedEvalCase {
  return manifest.kind === "eval";
}

export function resolveManifestReference(basePath: string, reference: string): string {
  return path.normalize(path.resolve(path.dirname(basePath), reference));
}
