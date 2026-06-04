import Ajv2020 from "ajv/dist/2020.js";
import type { CapabilityManifest } from "./generated/manifest-types.js";
import type {
  AicfDiagnostic,
  DecisionAuditPreview,
  DecisionFact,
  DecisionOptions,
  DecisionReason,
  DecisionRequest,
  DecisionResult,
  DecisionStatus,
  LifecycleEvaluation,
  LoadedCapabilityManifest,
  ManifestRegistry,
  PolicyEvaluation
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

const autonomyRank = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5
} as const;

const riskRank = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
} as const;

export function decideCapability(
  registry: ManifestRegistry,
  request: DecisionRequest,
  options: DecisionOptions = {}
): DecisionResult {
  const loadedCapability = registry.capabilityById.get(request.capabilityId);

  if (!loadedCapability) {
    const reasons = [{
      code: "capability_not_found",
      message: `Capability "${request.capabilityId}" was not found.`
    }] satisfies DecisionReason[];
    return buildDecisionResult(request, "denied", {
      diagnostics: [],
      reasons,
      requiredApprovals: [],
      status: "denied"
    }, {
      reasons: [],
      status: "allowed"
    });
  }

  const policy = evaluatePolicy(loadedCapability, request, options);
  const lifecycle = evaluateLifecycle(loadedCapability, request);
  const status = combineStatuses(policy.status, lifecycle.status);

  return buildDecisionResult(request, status, policy, lifecycle);
}

export function evaluatePolicy(
  capability: LoadedCapabilityManifest | CapabilityManifest,
  request: DecisionRequest,
  options: DecisionOptions = {}
): PolicyEvaluation {
  const manifest = unwrapCapability(capability);
  const reasons: DecisionReason[] = [];
  const requiredApprovals: DecisionReason[] = [];
  const diagnostics: AicfDiagnostic[] = [];

  const statusReason = statusDecisionReason(manifest, options);
  if (statusReason) {
    reasons.push(statusReason);
  }

  if (manifest.authorization.requires_user_context && !hasText(request.context.userId)) {
    reasons.push({
      code: "missing_user_context",
      message: "Capability requires request.context.userId."
    });
  }

  if (manifest.authorization.tenant_scoped && !hasText(request.context.tenantId)) {
    reasons.push({
      code: "missing_tenant_context",
      message: "Capability requires request.context.tenantId."
    });
  }

  for (const permission of manifest.authorization.permissions) {
    if (!request.context.permissions.includes(permission)) {
      reasons.push({
        code: "missing_permission",
        message: `Missing required permission "${permission}".`
      });
    }
  }

  const maxAutonomyTier = manifest.policy.max_autonomy_tier ?? manifest.autonomy_tier;
  if (autonomyRank[request.context.autonomyTier] > autonomyRank[manifest.autonomy_tier]) {
    reasons.push({
      code: "autonomy_exceeded",
      message: `Request autonomy tier ${request.context.autonomyTier} exceeds capability tier ${manifest.autonomy_tier}.`
    });
  }

  if (autonomyRank[request.context.autonomyTier] > autonomyRank[maxAutonomyTier]) {
    reasons.push({
      code: "autonomy_exceeded",
      message: `Request autonomy tier ${request.context.autonomyTier} exceeds policy max tier ${maxAutonomyTier}.`
    });
  }

  if (request.context.riskCeiling && riskRank[manifest.risk_tier] > riskRank[request.context.riskCeiling]) {
    reasons.push({
      code: "risk_tier_exceeded",
      message: `Capability risk tier ${manifest.risk_tier} exceeds context risk ceiling ${request.context.riskCeiling}.`
    });
  }

  if (request.context.allowedRiskTiers && !request.context.allowedRiskTiers.includes(manifest.risk_tier)) {
    reasons.push({
      code: "risk_tier_not_allowed",
      message: `Capability risk tier ${manifest.risk_tier} is not allowed by context.allowedRiskTiers.`
    });
  }

  const argsValidation = validateArgs(manifest, request);
  reasons.push(...argsValidation.reasons);
  diagnostics.push(...argsValidation.diagnostics);

  if (request.operation !== "select") {
    for (const rule of manifest.policy.deny_if ?? []) {
      const fact = readFact(request.facts?.[rule.rule]);
      if (!fact.known) {
        const missingBehavior = rule.missing_behavior ?? "deny";
        if (missingBehavior === "ignore") {
          continue;
        }

        if (missingBehavior === "approval_required") {
          const approvalReason = {
            code: "approval_required",
            message: `Deny rule "${rule.rule}" could not be evaluated and requires approval.`,
            rule: rule.rule
          } satisfies DecisionReason;
          if (request.operation === "commit" && !isApproved(request)) {
            reasons.push(approvalReason);
          } else {
            requiredApprovals.push(approvalReason);
          }
          continue;
        }

        reasons.push({
          code: "missing_fact",
          message: `Deny rule "${rule.rule}" could not be evaluated and failed closed.`,
          rule: rule.rule
        });
        continue;
      }

      if (fact.value) {
        reasons.push({
          code: "deny_rule_matched",
          message: fact.reason ?? rule.reason,
          rule: rule.rule
        });
      }
    }

    for (const rule of manifest.policy.approval_required_if ?? []) {
      const ruleMatch = doesRuleMatch(rule, request.args ?? {});
      if (!ruleMatch.matched && ruleMatch.missing) {
        const missingBehavior = rule.missing_behavior ?? defaultApprovalMissingBehavior(manifest);
        if (missingBehavior === "deny") {
          reasons.push({
            code: "schema_validation_failed",
            message: `Approval rule "${rule.rule}" field "${rule.field}" is missing and failed closed.`,
            rule: rule.rule
          });
          continue;
        }

        if (missingBehavior === "ignore") {
          continue;
        }
      } else if (!ruleMatch.matched) {
        continue;
      }

      const approvalReason = {
        code: "approval_required",
        message: rule.reason,
        rule: rule.rule
      } satisfies DecisionReason;

      if (request.operation === "commit" && !isApproved(request)) {
        reasons.push(approvalReason);
      } else {
        requiredApprovals.push(approvalReason);
      }
    }
  }

  if (request.operation === "commit" && manifest.policy.approval_required && !isApproved(request)) {
    reasons.push({
      code: "approval_required",
      message: "Capability commit requires approval."
    });
  }

  if (request.operation === "commit" && manifest.idempotency?.required && !request.idempotencyKey) {
    reasons.push({
      code: "idempotency_required",
      message: "Capability commit requires an idempotency key."
    });
  }

  if (reasons.length > 0) {
    return {
      diagnostics,
      reasons,
      requiredApprovals,
      status: "denied"
    };
  }

  if (requiredApprovals.length > 0 && !isApproved(request)) {
    return {
      diagnostics,
      reasons,
      requiredApprovals,
      status: "approval_required"
    };
  }

  return {
    diagnostics,
    reasons,
    requiredApprovals,
    status: "allowed"
  };
}

export function evaluateLifecycle(
  capability: LoadedCapabilityManifest | CapabilityManifest,
  request: DecisionRequest
): LifecycleEvaluation {
  const manifest = unwrapCapability(capability);
  const reasons: DecisionReason[] = [];

  if (request.operation === "select") {
    return {
      reasons,
      status: "allowed"
    };
  }

  if (request.operation === "prepare" && !manifest.lifecycle.prepare) {
    reasons.push({
      code: "lifecycle_not_supported",
      message: `Capability "${manifest.id}" does not support prepare.`
    });
  }

  if (request.operation === "commit" && !manifest.lifecycle.commit) {
    reasons.push({
      code: "lifecycle_not_supported",
      message: `Capability "${manifest.id}" does not support commit.`
    });
  }

  return {
    reasons,
    status: reasons.length > 0 ? "denied" : "allowed"
  };
}

function buildDecisionResult(
  request: DecisionRequest,
  status: DecisionStatus,
  policy: PolicyEvaluation,
  lifecycle: LifecycleEvaluation
): DecisionResult {
  const reasons = [...policy.reasons, ...policy.requiredApprovals, ...lifecycle.reasons];
  const audit: DecisionAuditPreview = {
    capabilityId: request.capabilityId,
    operation: request.operation,
    reasons,
    status
  };

  if (request.idempotencyKey) {
    audit.idempotencyKey = request.idempotencyKey;
  }

  return {
    audit,
    capabilityId: request.capabilityId,
    diagnostics: policy.diagnostics,
    lifecycle,
    operation: request.operation,
    policy,
    reasons,
    requiredApprovals: policy.requiredApprovals,
    status
  };
}

function validateArgs(
  capability: CapabilityManifest,
  request: DecisionRequest
): {
  diagnostics: AicfDiagnostic[];
  reasons: DecisionReason[];
} {
  if (request.operation === "select" && request.args === undefined) {
    return {
      diagnostics: [],
      reasons: []
    };
  }

  if ((request.operation === "prepare" || request.operation === "commit") && request.args === undefined) {
    return {
      diagnostics: [],
      reasons: [{
        code: "missing_args",
        message: "Capability prepare/commit requires args."
      }]
    };
  }

  if (!isRecord(request.args)) {
    return {
      diagnostics: [],
      reasons: [{
        code: "schema_validation_failed",
        message: "Capability input did not match input_schema."
      }]
    };
  }

  const validate = ajv.compile(capability.input_schema);
  const valid = validate(request.args);
  if (valid) {
    return {
      diagnostics: [],
      reasons: []
    };
  }

  return {
    diagnostics: (validate.errors ?? []).map((error) => ({
      code: "schema_validation_failed",
      details: error,
      id: capability.id,
      kind: "capability",
      message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`,
      path: capability.id
    })),
    reasons: [{
      code: "schema_validation_failed",
      message: "Capability input did not match input_schema."
    }]
  };
}

function statusDecisionReason(
  capability: CapabilityManifest,
  options: DecisionOptions
): DecisionReason | undefined {
  switch (capability.status) {
    case "active":
      return undefined;
    case "disabled":
      return options.includeDisabledForTests ? undefined : {
        code: "status_disabled",
        message: `Capability "${capability.id}" is disabled.`
      };
    case "deprecated":
      return options.includeDeprecated ? undefined : {
        code: "status_deprecated",
        message: `Capability "${capability.id}" is deprecated and requires explicit inclusion.`
      };
    case "draft":
      return options.includeDraft ? undefined : {
        code: "status_draft",
        message: `Capability "${capability.id}" is draft and requires explicit inclusion.`
      };
    case "experimental":
      return options.includeExperimental ? undefined : {
        code: "status_experimental",
        message: `Capability "${capability.id}" is experimental and requires explicit inclusion.`
      };
  }
}

function combineStatuses(...statuses: DecisionStatus[]): DecisionStatus {
  if (statuses.includes("denied")) return "denied";
  if (statuses.includes("approval_required")) return "approval_required";
  return "allowed";
}

function unwrapCapability(capability: LoadedCapabilityManifest | CapabilityManifest): CapabilityManifest {
  return "manifest" in capability ? capability.manifest : capability;
}

function readFact(fact: DecisionFact | undefined): { known: boolean; reason?: string; value: boolean } {
  if (typeof fact === "boolean") {
    return {
      known: true,
      value: fact
    };
  }

  if (typeof fact === "object" && fact !== null) {
    return {
      known: true,
      reason: fact.reason,
      value: fact.value
    };
  }

  return {
    known: false,
    value: false
  };
}

function doesRuleMatch(
  rule: NonNullable<CapabilityManifest["policy"]["approval_required_if"]>[number],
  args: Record<string, unknown>
): { matched: boolean; missing: boolean } {
  if (!rule.field || !rule.operator) {
    return {
      matched: false,
      missing: false
    };
  }

  const value = getFieldValue(rule.field, args);
  if (value === undefined) {
    return {
      matched: false,
      missing: true
    };
  }

  switch (rule.operator) {
    case "eq":
      return { matched: value === rule.value, missing: false };
    case "neq":
      return { matched: value !== rule.value, missing: false };
    case "gt":
      return { matched: typeof value === "number" && typeof rule.value === "number" && value > rule.value, missing: false };
    case "gte":
      return { matched: typeof value === "number" && typeof rule.value === "number" && value >= rule.value, missing: false };
    case "lt":
      return { matched: typeof value === "number" && typeof rule.value === "number" && value < rule.value, missing: false };
    case "lte":
      return { matched: typeof value === "number" && typeof rule.value === "number" && value <= rule.value, missing: false };
    case "in":
      return { matched: Array.isArray(rule.value) && rule.value.includes(value), missing: false };
    case "not_in":
      return { matched: Array.isArray(rule.value) && !rule.value.includes(value), missing: false };
    case "exists":
      return { matched: true, missing: false };
  }
}

function defaultApprovalMissingBehavior(capability: CapabilityManifest): "approval_required" | "ignore" {
  return riskRank[capability.risk_tier] >= riskRank.medium ? "approval_required" : "ignore";
}

function getFieldValue(field: string, args: Record<string, unknown>): unknown {
  const normalizedField = field.startsWith("args.") ? field.slice("args.".length) : field;
  return normalizedField.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, args);
}

function isApproved(request: DecisionRequest): boolean {
  return request.approval?.approved === true && Boolean(request.approval.approvalId);
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
