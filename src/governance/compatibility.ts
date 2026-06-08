import type { CapabilityManifest } from "../types.js";
import { governanceRequirement, riskRank } from "./helpers.js";
import type { CompatibilityChange, CompatibilityDiff, CompatibilityLevel } from "./types.js";

export function compareCapabilityVersions(
  before: CapabilityManifest,
  after: CapabilityManifest
): CompatibilityDiff {
  const changes: CompatibilityChange[] = [
    ...compareObjectSchema("input_schema", before.input_schema, after.input_schema),
    ...compareObjectSchema("output_schema", before.output_schema, after.output_schema),
    ...compareLifecycle(before, after),
    ...compareRisk(before, after),
    ...compareApproval(before, after),
    ...compareSideEffects(before, after),
    ...compareIdempotencyAndAudit(before, after),
    ...compareMetadata(before, after)
  ];
  const compatibility = aggregateCompatibility(changes);

  return {
    capabilityId: after.id,
    changes,
    compatibility,
    fromVersion: before.version,
    requiredActions: compatibility === "breaking"
      ? [governanceRequirement("breaking_change_review_required", "Breaking compatibility changes require an explicit migration plan.")]
      : [],
    toVersion: after.version
  };
}

function compareObjectSchema(path: "input_schema" | "output_schema", before: Record<string, unknown>, after: Record<string, unknown>): CompatibilityChange[] {
  const changes: CompatibilityChange[] = [];
  const beforeProperties = propertiesOf(before);
  const afterProperties = propertiesOf(after);
  const beforeRequired = requiredOf(before);
  const afterRequired = requiredOf(after);

  for (const property of Object.keys(beforeProperties)) {
    if (!(property in afterProperties)) {
      changes.push(change("property_removed", "breaking", `${path}.${property} was removed.`, `${path}.properties.${property}`));
    }
  }

  for (const property of Object.keys(afterProperties)) {
    if (!(property in beforeProperties)) {
      const compatibility = afterRequired.has(property) ? "breaking" : "requires_minor";
      changes.push(change(
        afterRequired.has(property) ? "required_property_added" : "optional_property_added",
        compatibility,
        `${path}.${property} was added as ${afterRequired.has(property) ? "required" : "optional"}.`,
        `${path}.properties.${property}`
      ));
      continue;
    }

    changes.push(...compareEnumValues(path, property, beforeProperties[property], afterProperties[property]));
  }

  for (const property of afterRequired) {
    if (!beforeRequired.has(property) && property in beforeProperties) {
      changes.push(change("property_became_required", "breaking", `${path}.${property} changed from optional to required.`, `${path}.required`));
    }
  }

  return changes;
}

function compareEnumValues(
  schemaPath: string,
  property: string,
  before: unknown,
  after: unknown
): CompatibilityChange[] {
  const beforeEnum = enumOf(before);
  const afterEnum = enumOf(after);
  if (!beforeEnum || !afterEnum) {
    return [];
  }

  const removed = beforeEnum.filter((value) => !afterEnum.includes(value));
  const added = afterEnum.filter((value) => !beforeEnum.includes(value));
  const changes: CompatibilityChange[] = [];
  if (removed.length > 0) {
    changes.push(change("enum_values_removed", "breaking", `${schemaPath}.${property} removed enum values: ${removed.join(", ")}.`, `${schemaPath}.properties.${property}.enum`));
  }
  if (added.length > 0) {
    changes.push(change("enum_values_added", "requires_minor", `${schemaPath}.${property} added enum values: ${added.join(", ")}.`, `${schemaPath}.properties.${property}.enum`));
  }

  return changes;
}

function compareLifecycle(before: CapabilityManifest, after: CapabilityManifest): CompatibilityChange[] {
  const changes: CompatibilityChange[] = [];
  if (!before.lifecycle.commit && after.lifecycle.commit) {
    changes.push(change("commit_lifecycle_added", "breaking", "Capability changed to support commit lifecycle.", "lifecycle.commit"));
  }
  if (before.capability_type === "write_prepare_only" && after.capability_type === "write_commit") {
    changes.push(change("prepare_to_commit_type_change", "breaking", "Capability type changed from prepare-only to commit.", "capability_type"));
  }
  if (before.lifecycle.audit && !after.lifecycle.audit) {
    changes.push(change("audit_removed", "breaking", "Lifecycle audit support was removed.", "lifecycle.audit"));
  }

  return changes;
}

function compareRisk(before: CapabilityManifest, after: CapabilityManifest): CompatibilityChange[] {
  if (riskRank[after.risk_tier] < riskRank[before.risk_tier]) {
    return [change("risk_tier_lowered", "breaking", `Risk tier changed downward from ${before.risk_tier} to ${after.risk_tier}.`, "risk_tier")];
  }
  if (riskRank[after.risk_tier] > riskRank[before.risk_tier]) {
    return [change("risk_tier_raised", "requires_minor", `Risk tier changed upward from ${before.risk_tier} to ${after.risk_tier}.`, "risk_tier")];
  }

  return [];
}

function compareApproval(before: CapabilityManifest, after: CapabilityManifest): CompatibilityChange[] {
  const beforeApproval = approvalStrength(before);
  const afterApproval = approvalStrength(after);
  if (afterApproval < beforeApproval) {
    return [change("approval_requirement_lowered", "breaking", "Approval requirements were lowered.", "policy")];
  }
  if (afterApproval > beforeApproval) {
    return [change("approval_requirement_raised", "requires_minor", "Approval requirements became stricter.", "policy")];
  }

  return [];
}

function compareSideEffects(before: CapabilityManifest, after: CapabilityManifest): CompatibilityChange[] {
  const changes: CompatibilityChange[] = [];
  for (const [key, beforeValue] of Object.entries(before.side_effects)) {
    const afterValue = after.side_effects[key as keyof CapabilityManifest["side_effects"]];
    if (!beforeValue && afterValue) {
      changes.push(change("side_effect_added", "breaking", `Side effect ${key} was added.`, `side_effects.${key}`));
    }
  }

  return changes;
}

function compareIdempotencyAndAudit(before: CapabilityManifest, after: CapabilityManifest): CompatibilityChange[] {
  const changes: CompatibilityChange[] = [];
  if (before.idempotency?.required && after.idempotency?.required !== true) {
    changes.push(change("idempotency_removed", "breaking", "Required idempotency was removed.", "idempotency.required"));
  }
  return changes;
}

function compareMetadata(before: CapabilityManifest, after: CapabilityManifest): CompatibilityChange[] {
  const changes: CompatibilityChange[] = [];
  if (before.model_description !== after.model_description || before.summary !== after.summary || before.name !== after.name) {
    changes.push(change("description_changed", "compatible", "Descriptive metadata changed.", "summary"));
  }
  if ((after.evals?.golden?.length ?? 0) > (before.evals?.golden?.length ?? 0)) {
    changes.push(change("eval_examples_added", "compatible", "Golden eval references were added.", "evals.golden"));
  }
  return changes;
}

function aggregateCompatibility(changes: CompatibilityChange[]): CompatibilityLevel {
  if (changes.some((entry) => entry.compatibility === "breaking")) {
    return "breaking";
  }
  if (changes.some((entry) => entry.compatibility === "requires_minor")) {
    return "requires_minor";
  }

  return "compatible";
}

function change(code: string, compatibility: CompatibilityLevel, message: string, path?: string): CompatibilityChange {
  return {
    code,
    compatibility,
    message,
    path
  };
}

function propertiesOf(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {};
}

function requiredOf(schema: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []);
}

function enumOf(value: unknown): string[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const maybeEnum = (value as Record<string, unknown>).enum;
  return Array.isArray(maybeEnum) ? maybeEnum.map(String) : null;
}

function approvalStrength(capability: CapabilityManifest): number {
  if (capability.policy.approval_required) return 2;
  if ((capability.policy.approval_required_if?.length ?? 0) > 0) return 1;
  return 0;
}
