import type { CapabilityManifest } from "./generated/manifest-types.js";
import type {
  DecisionAuditPreview,
  DecisionFact,
  DecisionReason,
  DecisionRequest,
  DecisionResult,
  DecisionStatus,
  LifecycleEvaluation,
  LoadedCapabilityManifest,
  ManifestRegistry,
  PolicyEvaluation
} from "./types.js";

const autonomyRank = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5
} as const;

export function decideCapability(
  registry: ManifestRegistry,
  request: DecisionRequest
): DecisionResult {
  const loadedCapability = registry.capabilityById.get(request.capabilityId);

  if (!loadedCapability) {
    const reasons = [{
      code: "capability_not_found",
      message: `Capability "${request.capabilityId}" was not found.`
    }] satisfies DecisionReason[];
    return buildDecisionResult(request, "denied", {
      reasons,
      requiredApprovals: [],
      status: "denied"
    }, {
      reasons: [],
      status: "allowed"
    });
  }

  const policy = evaluatePolicy(loadedCapability, request);
  const lifecycle = evaluateLifecycle(loadedCapability, request);
  const status = combineStatuses(policy.status, lifecycle.status);

  return buildDecisionResult(request, status, policy, lifecycle);
}

export function evaluatePolicy(
  capability: LoadedCapabilityManifest | CapabilityManifest,
  request: DecisionRequest
): PolicyEvaluation {
  const manifest = unwrapCapability(capability);
  const reasons: DecisionReason[] = [];
  const requiredApprovals: DecisionReason[] = [];

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

  if (request.operation !== "select") {
    for (const rule of manifest.policy.deny_if ?? []) {
      const fact = readFact(request.facts?.[rule.rule]);
      if (!fact.known) {
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
      if (doesRuleMatch(rule, request.args ?? {})) {
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
      reasons,
      requiredApprovals,
      status: "denied"
    };
  }

  if (requiredApprovals.length > 0 && !isApproved(request)) {
    return {
      reasons,
      requiredApprovals,
      status: "approval_required"
    };
  }

  return {
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
    diagnostics: [],
    lifecycle,
    operation: request.operation,
    policy,
    reasons,
    requiredApprovals: policy.requiredApprovals,
    status
  };
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
): boolean {
  if (!rule.field || !rule.operator) {
    return false;
  }

  const value = getFieldValue(rule.field, args);

  switch (rule.operator) {
    case "eq":
      return value === rule.value;
    case "neq":
      return value !== rule.value;
    case "gt":
      return typeof value === "number" && typeof rule.value === "number" && value > rule.value;
    case "gte":
      return typeof value === "number" && typeof rule.value === "number" && value >= rule.value;
    case "lt":
      return typeof value === "number" && typeof rule.value === "number" && value < rule.value;
    case "lte":
      return typeof value === "number" && typeof rule.value === "number" && value <= rule.value;
    case "in":
      return Array.isArray(rule.value) && rule.value.includes(value);
    case "not_in":
      return Array.isArray(rule.value) && !rule.value.includes(value);
    case "exists":
      return value !== undefined;
  }
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
