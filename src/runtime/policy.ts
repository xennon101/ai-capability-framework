import { decideCapability } from "../decision.js";
import type {
  DecisionReason,
  DecisionRequest,
  DecisionResult,
  ManifestRegistry,
  RiskTier
} from "../types.js";
import { isRestrictedCapability } from "../adapter-common.js";
import type {
  AicfApprovalRequirement,
  AicfHostPolicyHook,
  AicfPolicyBroker,
  AicfPolicyDecision,
  AicfPolicyEvaluationInput,
  AicfPolicyReason,
  AicfRuntimeContext
} from "./types.js";

const riskRank: Record<RiskTier, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};
const autonomyRank = {
  A0: 0,
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  A5: 5
} as const;

export class DefaultPolicyBroker implements AicfPolicyBroker {
  private hostPolicyHook?: AicfHostPolicyHook;

  constructor(options: {
    hostPolicyHook?: AicfHostPolicyHook;
  } = {}) {
    this.hostPolicyHook = options.hostPolicyHook;
  }

  async evaluate(input: AicfPolicyEvaluationInput): Promise<AicfPolicyDecision> {
    const defaultDecision = evaluateDefaultPolicy(input);

    if (!this.hostPolicyHook) {
      return defaultDecision;
    }

    let hostDecision: AicfPolicyDecision | null;
    try {
      hostDecision = await this.hostPolicyHook(input);
    } catch {
      return {
        reasons: [
          ...defaultDecision.reasons,
          {
            code: "host_policy_error",
            message: "Host policy hook failed closed.",
            severity: "error",
            source: "host"
          }
        ],
        requiredApprovals: defaultDecision.requiredApprovals,
        status: "denied"
      };
    }

    if (!hostDecision) {
      return defaultDecision;
    }

    return combineDefaultAndHostDecision(defaultDecision, hostDecision);
  }
}

function evaluateDefaultPolicy(input: AicfPolicyEvaluationInput): AicfPolicyDecision {
  const runtimeReasons = runtimeContextReasons(input.runtimeContext);
  const sideEffectReasons = sideEffectReasonsFor(input);
  const approvalReasons = approvalReasonsFor(input);
  const coreDecision = decideCapability(singleCapabilityRegistry(input), {
    args: input.args,
    approval: input.approval ? {
      approvalId: input.approval.approvalId,
      approved: input.approval.approved
    } : undefined,
    capabilityId: input.capability.manifest.id,
    context: decisionContext(input),
    facts: input.facts,
    idempotencyKey: input.idempotencyKey,
    operation: input.operation
  });
  const coreReasons = coreDecision.reasons.map(reasonFromCore);
  const allDenyReasons = [
    ...runtimeReasons,
    ...sideEffectReasons,
    ...approvalReasons.filter((reason) => reason.code !== "approval_missing"),
    ...coreReasons.filter((reason) => reason.code !== "approval_required" || input.operation === "commit")
  ];
  const requiredApprovals = approvalRequirements(coreDecision, approvalReasons);

  if (allDenyReasons.length > 0) {
    return {
      reasons: allDenyReasons,
      requiredApprovals,
      status: "denied"
    };
  }

  if (
    coreDecision.status === "approval_required"
    || coreReasons.some((reason) => reason.code === "approval_required")
    || approvalReasons.some((reason) => reason.code === "approval_missing")
  ) {
    return {
      reasons: coreReasons.filter((reason) => reason.code === "approval_required"),
      requiredApprovals,
      status: "approval_required"
    };
  }

  return {
    reasons: coreReasons,
    requiredApprovals,
    status: "allowed"
  };
}

function combineDefaultAndHostDecision(
  defaultDecision: AicfPolicyDecision,
  hostDecision: AicfPolicyDecision
): AicfPolicyDecision {
  if (defaultDecision.status === "denied") {
    return {
      ...defaultDecision,
      reasons: [...defaultDecision.reasons, ...hostDecision.reasons]
    };
  }

  if (hostDecision.status === "denied") {
    return {
      reasons: [...defaultDecision.reasons, ...hostDecision.reasons],
      requiredApprovals: [...defaultDecision.requiredApprovals, ...hostDecision.requiredApprovals],
      status: "denied"
    };
  }

  if (defaultDecision.status === "approval_required" || hostDecision.status === "approval_required") {
    return {
      reasons: [...defaultDecision.reasons, ...hostDecision.reasons],
      requiredApprovals: [...defaultDecision.requiredApprovals, ...hostDecision.requiredApprovals],
      status: "approval_required"
    };
  }

  return {
    reasons: [...defaultDecision.reasons, ...hostDecision.reasons],
    requiredApprovals: [...defaultDecision.requiredApprovals, ...hostDecision.requiredApprovals],
    status: "allowed"
  };
}

function runtimeContextReasons(context: AicfRuntimeContext): AicfPolicyReason[] {
  const reasons: AicfPolicyReason[] = [];

  if (!hasText(context.subject.userId)) {
    reasons.push(policyReason("missing_user_context", "Runtime subject userId is required."));
  }

  if (!hasText(context.account.accountId)) {
    reasons.push(policyReason("missing_account_context", "Runtime accountId is required."));
  }

  if (!hasText(context.account.tenantId)) {
    reasons.push(policyReason("missing_tenant_context", "Runtime tenantId is required."));
  }

  return reasons;
}

function sideEffectReasonsFor(input: AicfPolicyEvaluationInput): AicfPolicyReason[] {
  const capability = input.capability.manifest;
  const reasons: AicfPolicyReason[] = [];

  if (riskRank[capability.risk_tier] > riskRank[input.runtimeContext.autonomy.maxRiskTier]) {
    reasons.push(policyReason("risk_tier_exceeded", "Capability risk exceeds runtime risk ceiling."));
  }

  if (isRestrictedCapability(capability) && !input.runtimeContext.autonomy.allowSideEffects) {
    reasons.push(policyReason("side_effects_not_allowed", "Runtime autonomy does not allow side effects."));
  }

  if (
    (capability.side_effects.sends_external_messages || capability.capability_type === "external_message_send")
    && !input.runtimeContext.autonomy.allowExternalMessages
  ) {
    reasons.push(policyReason("external_messages_not_allowed", "Runtime autonomy does not allow external messages."));
  }

  if (
    (capability.side_effects.charges_money || capability.side_effects.refunds_money)
    && !input.runtimeContext.autonomy.allowMoneyMovement
  ) {
    reasons.push(policyReason("money_movement_not_allowed", "Runtime autonomy does not allow money movement."));
  }

  if (capability.side_effects.changes_permissions && !input.runtimeContext.autonomy.allowPermissionChanges) {
    reasons.push(policyReason("permission_changes_not_allowed", "Runtime autonomy does not allow permission changes."));
  }

  return reasons;
}

function approvalReasonsFor(input: AicfPolicyEvaluationInput): AicfPolicyReason[] {
  if (!input.approval) {
    return [];
  }

  if (!input.approval.approved) {
    return [policyReason("approval_rejected", "Approval was explicitly rejected.")];
  }

  if (input.approval.expiresAt && Date.parse(input.approval.expiresAt) <= Date.now()) {
    return [policyReason("approval_expired", "Approval has expired.")];
  }

  return [];
}

function approvalRequirements(
  coreDecision: DecisionResult,
  approvalReasons: AicfPolicyReason[]
): AicfApprovalRequirement[] {
  const requirements = coreDecision.requiredApprovals.map((reason) => ({
    approvalType: "user_confirmation" as const,
    reason: reason.message
  }));

  if (coreDecision.reasons.some((reason) => reason.code === "approval_required")) {
    requirements.push({
      approvalType: "user_confirmation",
      reason: "Capability requires approval."
    });
  }

  if (approvalReasons.some((reason) => reason.code === "approval_missing")) {
    requirements.push({
      approvalType: "user_confirmation",
      reason: "Approval is required."
    });
  }

  return requirements;
}

function reasonFromCore(reason: DecisionReason): AicfPolicyReason {
  return {
    code: reason.code,
    message: reason.message,
    ruleId: reason.rule,
    severity: reason.code === "approval_required" ? "warning" : "error",
    source: "aicf"
  };
}

function decisionContext(input: AicfPolicyEvaluationInput): DecisionRequest["context"] {
  const context = input.runtimeContext;
  const autonomyTier = autonomyRank[context.autonomy.autonomyTier] > autonomyRank[input.capability.manifest.autonomy_tier]
    ? input.capability.manifest.autonomy_tier
    : context.autonomy.autonomyTier;

  return {
    autonomyTier,
    permissions: context.subject.permissions,
    riskCeiling: context.autonomy.maxRiskTier,
    tenantId: context.account.tenantId,
    userId: context.subject.userId
  };
}

function singleCapabilityRegistry(input: AicfPolicyEvaluationInput): ManifestRegistry {
  return {
    capabilities: [input.capability],
    capabilityById: new Map([[input.capability.manifest.id, input.capability]]),
    entities: [],
    entityById: new Map(),
    evalById: new Map(),
    evals: [],
    warnings: []
  };
}

function policyReason(code: string, message: string): AicfPolicyReason {
  return {
    code,
    message,
    severity: "error",
    source: "aicf"
  };
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
