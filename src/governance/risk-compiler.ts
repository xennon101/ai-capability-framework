import type { CapabilityManifest, EntityManifest, RiskTier } from "../types.js";
import {
  governanceReason,
  hasDestructiveSideEffect,
  hasExternalSideEffect,
  hasMoneySideEffect,
  hasWriteOrExternalSideEffect,
  maxRisk,
  riskAtLeast,
  riskRank
} from "./helpers.js";
import type {
  RequiredControl,
  RequiredControlCode,
  RiskCompilationOptions,
  RiskCompilationResult
} from "./types.js";

const sensitiveClassifications = new Set([
  "confidential",
  "customer_pii",
  "employee_pii",
  "payment_metadata",
  "financial",
  "health",
  "legal",
  "security_sensitive",
  "credential_material",
  "regulated"
]);

const highSensitivityClassifications = new Set([
  "credential_material",
  "health",
  "regulated",
  "security_sensitive"
]);

export function compileCapabilityRisk(
  capability: CapabilityManifest,
  options: RiskCompilationOptions = {}
): RiskCompilationResult {
  const relatedEntities = relatedEntityManifests(capability, options.entities ?? []);
  const inferredMinimumRiskTier = inferMinimumRisk(capability, relatedEntities);
  const reasons = [];
  const warnings = [];
  const requiredControls = requiredControlsForCapability(capability, relatedEntities);

  if (riskRank[capability.risk_tier] < riskRank[inferredMinimumRiskTier]) {
    reasons.push(governanceReason(
      "risk_tier_too_low",
      `Declared risk tier ${capability.risk_tier} is below inferred minimum ${inferredMinimumRiskTier}.`
    ));
  }

  if (hasMoneySideEffect(capability) && !riskAtLeast(capability.risk_tier, "high")) {
    reasons.push(governanceReason("money_movement_high_risk_required", "Money-moving capabilities must be high or critical risk."));
  }

  if (capability.side_effects.irreversible && hasDestructiveSideEffect(capability) && capability.risk_tier !== "critical") {
    reasons.push(governanceReason("irreversible_critical_risk_required", "Irreversible destructive capabilities must be critical risk."));
  }

  if (capability.side_effects.changes_permissions && !riskAtLeast(capability.risk_tier, "high")) {
    reasons.push(governanceReason("permission_change_high_risk_required", "Permission-changing capabilities must be high or critical risk."));
  }

  if (capability.side_effects.sends_external_messages && !riskAtLeast(capability.risk_tier, "high") && !isInternalOnlyReversible(capability)) {
    reasons.push(governanceReason("external_send_high_risk_required", "External-send capabilities must be high or critical risk unless internal-only and reversible."));
  }

  if (capability.authorization.data_scope?.includes("current_tenant") && capability.authorization.tenant_scoped !== true) {
    reasons.push(governanceReason("tenant_scope_required", "Tenant-scoped data access must declare authorization.tenant_scoped: true."));
  }

  if (capability.authorization.tenant_scoped && capability.authorization.requires_user_context !== true && hasWriteOrExternalSideEffect(capability)) {
    reasons.push(governanceReason("user_context_required", "Tenant-scoped side-effecting capabilities must require user context."));
  }

  for (const control of requiredControls) {
    if (control.required && !control.present) {
      reasons.push(governanceReason(control.code, control.message));
    }
  }

  if (!capability.when_to_use || capability.when_to_use.length === 0) {
    warnings.push(governanceReason("usage_guidance_missing", "Capability should include when_to_use guidance.", "warning"));
  }

  if (!capability.when_not_to_use || capability.when_not_to_use.length === 0) {
    warnings.push(governanceReason("avoidance_guidance_missing", "Capability should include when_not_to_use guidance.", "warning"));
  }

  return {
    capabilityId: capability.id,
    declaredRiskTier: capability.risk_tier,
    inferredMinimumRiskTier,
    passed: reasons.length === 0,
    reasons,
    requiredControls,
    warnings
  };
}

function inferMinimumRisk(capability: CapabilityManifest, entities: EntityManifest[]): RiskTier {
  let inferred: RiskTier = "low";

  if (capability.side_effects.writes_data || capability.side_effects.creates_records || capability.side_effects.updates_records) {
    inferred = maxRisk(inferred, "medium");
  }

  if (hasExternalSideEffect(capability) || hasMoneySideEffect(capability) || hasDestructiveSideEffect(capability)) {
    inferred = maxRisk(inferred, "high");
  }

  if (capability.side_effects.irreversible || capability.side_effects.changes_permissions) {
    inferred = maxRisk(inferred, "critical");
  }

  for (const entity of entities) {
    const classification = entity.data_classification.default.toLowerCase();
    if (highSensitivityClassifications.has(classification)) {
      inferred = maxRisk(inferred, "high");
    } else if (sensitiveClassifications.has(classification)) {
      inferred = maxRisk(inferred, "medium");
    }
  }

  return inferred;
}

function requiredControlsForCapability(capability: CapabilityManifest, entities: EntityManifest[]): RequiredControl[] {
  const sensitive = entities.some((entity) => sensitiveClassifications.has(entity.data_classification.default.toLowerCase()));
  const sideEffecting = hasWriteOrExternalSideEffect(capability);
  const highRisk = riskAtLeast(capability.risk_tier, "high");
  const mediumOrHigher = riskAtLeast(capability.risk_tier, "medium");

  return [
    control("approval_required", highRisk || hasMoneySideEffect(capability) || hasDestructiveSideEffect(capability), hasApprovalControl(capability), "Required approval control is missing."),
    control("idempotency_required", sideEffecting || capability.lifecycle.commit, capability.idempotency?.required === true, "Required idempotency control is missing."),
    control("audit_required", sideEffecting || capability.lifecycle.audit, capability.lifecycle.audit === true, "Required audit lifecycle support is missing."),
    control("commit_not_model_exposed", capability.lifecycle.commit || capability.capability_type === "write_commit", true, "Commit capabilities must not be exposed directly to models."),
    control("redaction_required", sensitive || mediumOrHigher, hasRedactionControl(capability), "Required redaction control is missing."),
    control("retention_policy_required", sensitive || highRisk, hasRetentionControl(capability), "Required retention policy metadata is missing."),
    control("security_pack_required", highRisk, hasSecurityPackMetadata(capability), "Required security pack metadata is missing."),
    control("human_review_required", highRisk || capability.lifecycle.approve, hasApprovalControl(capability) || capability.lifecycle.approve, "Required human review control is missing.")
  ];
}

function control(code: RequiredControlCode, required: boolean, present: boolean, message: string): RequiredControl {
  return {
    code,
    message,
    present: required ? present : true,
    required
  };
}

function hasApprovalControl(capability: CapabilityManifest): boolean {
  return capability.policy.approval_required === true || (capability.policy.approval_required_if?.length ?? 0) > 0;
}

function hasRedactionControl(capability: CapabilityManifest): boolean {
  return ["none", "redacted"].includes(capability.observability.log_inputs)
    && ["none", "redacted", "summary"].includes(capability.observability.log_outputs);
}

function hasRetentionControl(capability: CapabilityManifest): boolean {
  const extensions = asRecord(capability.extensions);
  const governance = asRecord(extensions.governance);
  return typeof extensions.retention_policy === "string"
    || typeof governance.retention_policy === "string"
    || typeof governance.retentionPolicy === "string";
}

function hasSecurityPackMetadata(capability: CapabilityManifest): boolean {
  const extensions = asRecord(capability.extensions);
  const governance = asRecord(extensions.governance);
  return Array.isArray(extensions.security_packs)
    || Array.isArray(governance.security_packs)
    || Array.isArray(governance.securityPacks);
}

function isInternalOnlyReversible(capability: CapabilityManifest): boolean {
  const extensions = asRecord(capability.extensions);
  return extensions.internal_only === true && capability.side_effects.irreversible !== true;
}

function relatedEntityManifests(capability: CapabilityManifest, entities: EntityManifest[]): EntityManifest[] {
  return entities.filter((entity) => entity.allowed_actions.includes(capability.id) || entity.lookup.primary_capability === capability.id);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
