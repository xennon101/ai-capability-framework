import { validateManifests } from "../validator.js";
import type { ManifestRegistry, RiskTier } from "../types.js";
import {
  governanceReason,
  governanceRequirement,
  hasEvalCoverage,
  hasOwner,
  hasWriteOrExternalSideEffect,
  mapManifestStatus,
  riskAtLeast
} from "./helpers.js";
import type {
  CapabilityLifecycleStatus,
  GovernanceContext,
  GovernanceReason,
  GovernanceRequirement,
  LifecycleTransitionDecision,
  LifecycleTransitionRequest
} from "./types.js";

export function evaluateLifecycleTransition(
  registry: ManifestRegistry,
  request: LifecycleTransitionRequest,
  context: GovernanceContext = {}
): LifecycleTransitionDecision {
  const loadedCapability = registry.capabilityById.get(request.capabilityId);
  const from = request.from ?? (loadedCapability ? mapManifestStatus(loadedCapability.manifest.status) : "draft");
  const reasons: GovernanceReason[] = [];
  const warnings: GovernanceReason[] = [];
  const requiredActions: GovernanceRequirement[] = [];

  if (!loadedCapability) {
    reasons.push(governanceReason("capability_unknown", `Capability "${request.capabilityId}" is not loaded.`));
    return decision(from, request.to, reasons, warnings, requiredActions);
  }

  const capability = loadedCapability.manifest;
  const validation = context.validation ?? validateManifests([
    ...registry.capabilities,
    ...registry.entities,
    ...registry.evals
  ]);
  const capabilityErrors = validation.errors.filter((error) => error.id === capability.id || error.path === loadedCapability.path);
  const hasValidationErrors = capabilityErrors.length > 0;
  const emergencyOverride = contextOverrideEnabled(request);

  if (from === "removed") {
    reasons.push(governanceReason("removed_terminal", "Removed capabilities are terminal and cannot transition to another status."));
    return decision(from, request.to, reasons, warnings, requiredActions);
  }

  if (!request.reason?.trim()) {
    reasons.push(governanceReason("reason_required", "Lifecycle transitions require a human-readable reason."));
  }

  if (request.to === "disabled") {
    warnings.push(governanceReason("safety_disable", "Disabling a capability is always allowed for safety.", "info"));
    return decision(from, request.to, reasons, warnings, requiredActions);
  }

  if (request.to === "removed") {
    warnings.push(governanceReason("removed_terminal_after_transition", "Removed capabilities must not be exported or executed after this transition.", "warning"));
    return decision(from, request.to, reasons, warnings, requiredActions);
  }

  if (from === "draft" && request.to === "review") {
    if (!hasOwner(capability)) {
      requiredActions.push(governanceRequirement("owner_required", "Add owner.team and owner.contact before review."));
    }
    if (hasValidationErrors) {
      requiredActions.push(governanceRequirement("valid_manifest_required", "Resolve manifest schema and invariant errors before review."));
    }
  } else if (from === "review" && request.to === "approved") {
    if (hasValidationErrors) {
      requiredActions.push(governanceRequirement("semantic_invariants_required", "Resolve semantic invariant errors before approval."));
    }
    if (riskAtLeast(capability.risk_tier, "medium") && !hasEvalCoverage(capability)) {
      requiredActions.push(governanceRequirement("eval_coverage_required", "Medium and higher risk capabilities require linked eval coverage before approval."));
    }
    if (hasWriteOrExternalSideEffect(capability) && Object.keys(capability.policy).length === 0) {
      requiredActions.push(governanceRequirement("policy_metadata_required", "Side-effecting capabilities require policy metadata before approval."));
    }
  } else if (from === "approved" && request.to === "canary") {
    if (hasValidationErrors) {
      requiredActions.push(governanceRequirement("validation_clean_required", "Resolve validation errors before canary."));
    }
    if (context.deterministicEvalsPassed !== true) {
      requiredActions.push(governanceRequirement("deterministic_evals_required", "Pass deterministic evals before canary."));
    }
  } else if (from === "canary" && request.to === "production") {
    if (context.evalGatePassed !== true) {
      requiredActions.push(governanceRequirement("eval_gate_required", "Pass the governance eval gate before production."));
    }
    addActiveControlRequirements(requiredActions, context.activeCircuitBreakers, "circuit_breaker_active", "Resolve active circuit breakers before production.");
    addActiveControlRequirements(requiredActions, context.activeKillSwitches, "kill_switch_active", "Clear blocking kill switches before production.");
    addSecurityPackRequirements(requiredActions, capability.risk_tier, context);
  } else if (from === "production" && request.to === "deprecated") {
    if (!emergencyOverride && !context.replacementCapabilityId && !context.migrationNotes) {
      requiredActions.push(governanceRequirement("migration_notes_required", "Deprecating production capabilities requires replacement or migration notes unless emergency override is used."));
    }
  } else if (from === "disabled" && request.to === "production") {
    if (hasValidationErrors) {
      requiredActions.push(governanceRequirement("full_validation_required", "Disabled capabilities require full validation before production."));
    }
    if (!request.reason?.trim()) {
      requiredActions.push(governanceRequirement("explicit_reason_required", "Re-enabling a disabled capability requires an explicit reason."));
    }
  } else if (request.to === "production" && from !== "production") {
    requiredActions.push(governanceRequirement("canary_first_required", "Production transition must come from canary unless a documented emergency override is supplied."));
    if (emergencyOverride) {
      requiredActions.pop();
      warnings.push(governanceReason("emergency_override_used", "Emergency override bypassed the canary-first requirement.", "warning"));
    }
  }

  if (validation.warnings.some((warning) => warning.id === capability.id || warning.path === loadedCapability.path)) {
    warnings.push(governanceReason("validation_warnings_present", "Validation produced quality warnings for this capability.", "warning"));
  }

  return decision(from, request.to, reasons, warnings, requiredActions);
}

function decision(
  from: CapabilityLifecycleStatus,
  to: CapabilityLifecycleStatus,
  reasons: GovernanceReason[],
  warnings: GovernanceReason[],
  requiredActions: GovernanceRequirement[]
): LifecycleTransitionDecision {
  const blockingRequirements = requiredActions.filter((requirement) => requirement.severity === "blocking");
  const blockingReasons = reasons.filter((reason) => reason.severity === "blocking");

  return {
    allowed: blockingReasons.length === 0 && blockingRequirements.length === 0,
    from,
    reasons,
    requiredActions,
    to,
    warnings
  };
}

function addActiveControlRequirements(
  requirements: GovernanceRequirement[],
  activeControls: string[] | undefined,
  code: string,
  message: string
): void {
  for (const control of activeControls ?? []) {
    requirements.push(governanceRequirement(code, `${message} Active control: ${control}.`));
  }
}

function addSecurityPackRequirements(
  requirements: GovernanceRequirement[],
  riskTier: RiskTier,
  context: GovernanceContext
): void {
  if (!riskAtLeast(riskTier, "high")) {
    return;
  }

  const required = context.requiredSecurityPacks ?? ["capability-security-baseline"];
  const satisfied = new Set(context.satisfiedSecurityPacks ?? []);
  for (const pack of required) {
    if (!satisfied.has(pack)) {
      requirements.push(governanceRequirement("security_pack_required", `Required security pack "${pack}" must pass before production.`));
    }
  }
}

function contextOverrideEnabled(request: LifecycleTransitionRequest): boolean {
  return request.override?.emergency === true && Boolean(request.override.reason || request.override.approvedBy);
}
