import type { CapabilityManifest } from "../types.js";
import {
  hashAuditValue,
  redactAccountRef,
  redactSubjectRef,
  redactTenantRef,
  toRedactionSummary
} from "./redaction.js";
import type {
  ActionRecord,
  ApprovalRecord,
  AuditReason,
  CreateActionRecordInput,
  CreateApprovalRecordInput,
  CreateIdempotencyRecordInput,
  CreatePolicyDecisionRecordInput,
  IdempotencyRecord,
  PolicyDecisionRecord
} from "./types.js";

export function createPolicyDecisionRecord(input: CreatePolicyDecisionRecordInput): PolicyDecisionRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const inputHash = hashAuditValue(input.args ?? {});
  const decisionId = input.decisionId ?? stableId("decision", [
    input.runtimeContext.runId,
    input.runtimeContext.requestId,
    input.capability.id,
    input.operation,
    input.policyDecision.status,
    inputHash
  ]);

  return {
    accountRef: redactAccountRef(input.runtimeContext.account, input.diagnosticMode),
    autonomyTier: input.runtimeContext.autonomy.autonomyTier,
    capabilityId: input.capability.id,
    capabilityVersion: input.capability.version,
    createdAt,
    decision: input.policyDecision.status,
    decisionId,
    inputHash,
    operation: input.operation,
    policySource: {
      source: policySource(input.policyDecision),
      version: input.policyDecision.policyVersion
    },
    reasons: input.policyDecision.reasons.map(reasonToAuditReason),
    redaction: toRedactionSummary(undefined, input.diagnosticMode),
    riskTier: input.capability.risk_tier,
    runId: input.runtimeContext.runId,
    schemaVersion: "1.0",
    selectedCapabilitySliceHash: input.selectedCapabilitySliceHash,
    subjectRef: redactSubjectRef(input.runtimeContext.subject, input.diagnosticMode),
    tenantRef: redactTenantRef(input.runtimeContext.account, input.diagnosticMode),
    traceRef: input.traceRef
  };
}

export function createActionRecord(input: CreateActionRecordInput): ActionRecord {
  const now = input.createdAt ?? new Date().toISOString();
  const inputHash = hashAuditValue(input.args ?? {});
  const previewHash = input.preview === undefined ? undefined : hashAuditValue(input.preview);
  const resultHash = input.result === undefined ? undefined : hashAuditValue(input.result);
  const actionId = input.actionId ?? stableId("action", [
    input.preparedActionId ?? "",
    input.runId,
    input.capability.id,
    input.actionState,
    inputHash
  ]);

  return {
    actionId,
    actionState: input.actionState,
    auditRefs: input.auditRefs ?? [],
    capabilityId: input.capability.id,
    capabilityVersion: input.capability.version,
    createdAt: now,
    expiresAt: input.expiresAt,
    idempotencyKeyHash: input.idempotencyKey ? hashAuditValue({ idempotencyKey: input.idempotencyKey }) : undefined,
    inputHash,
    policyDecisionId: input.policyDecisionId,
    preparedActionId: input.preparedActionId,
    previewHash,
    resultHash,
    runId: input.runId,
    schemaVersion: "1.0",
    traceRef: input.traceRef,
    updatedAt: input.updatedAt ?? now
  };
}

export function createApprovalRecord(input: CreateApprovalRecordInput): ApprovalRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const approvalRecordId = input.approvalRecordId
    ?? stableId("approval", [input.approval?.approvalId ?? "", input.preparedActionId, input.capabilityId]);
  const status = input.status ?? approvalStatus(input.approval);

  return {
    approvalRecordId,
    capabilityId: input.capabilityId,
    createdAt,
    decidedAt: input.approval?.decidedAt,
    decidedBy: input.approval?.decidedBy ? redactSubjectRef({
      actorType: input.approval.decidedBy.actorType,
      userId: input.approval.decidedBy.actorId
    }, input.diagnosticMode) : undefined,
    decisionReason: input.approval?.reason,
    expiresAt: input.approval?.expiresAt,
    preparedActionId: input.preparedActionId,
    requestedBy: redactSubjectRef(input.requestedBy, input.diagnosticMode) ?? { refHash: hashAuditValue("unknown") },
    requiredReasonCodes: input.requiredReasonCodes ?? [],
    schemaVersion: "1.0",
    status,
    traceRef: input.traceRef
  };
}

export function createIdempotencyRecord(input: CreateIdempotencyRecordInput): IdempotencyRecord {
  const status = input.status ?? (input.resultRef ? "completed" : "reserved");
  const keyHash = hashAuditValue({ key: input.key });
  const scopeHash = hashAuditValue({ scope: input.scope });

  return {
    completedAt: status === "completed" ? input.createdAt ?? new Date().toISOString() : undefined,
    createdAt: input.createdAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt,
    idempotencyRecordId: stableId("idempotency", [scopeHash, keyHash]),
    keyHash,
    metadataHash: input.metadata ? hashAuditValue(input.metadata) : undefined,
    resultRef: input.resultRef,
    schemaVersion: "1.0",
    scopeHash,
    status
  };
}

export function actionIdForPreparedAction(preparedActionId: string): string {
  return stableId("action", [preparedActionId]);
}

export function resultRefFromValue(value: unknown, resultType?: string): { resultHash: string; resultType?: string } {
  return {
    resultHash: hashAuditValue(value),
    resultType
  };
}

export function stableId(prefix: string, parts: unknown[]): string {
  const digest = hashAuditValue(parts).replace("sha256:", "").slice(0, 24);
  return `${prefix}_${digest}`;
}

function reasonToAuditReason(reason: { code: string; message: string; ruleId?: string; severity?: string; source?: string }): AuditReason {
  return {
    code: reason.code,
    message: reason.message,
    ruleId: reason.ruleId,
    severity: reason.severity,
    source: reason.source
  };
}

function policySource(policyDecision: { reasons: Array<{ source?: string }> }): "aicf" | "auth_platform" | "host" | "policy_engine" {
  if (policyDecision.reasons.some((reason) => reason.source === "host")) return "host";
  if (policyDecision.reasons.some((reason) => reason.source === "policy_engine")) return "policy_engine";
  if (policyDecision.reasons.some((reason) => reason.source === "auth_platform")) return "auth_platform";
  return "aicf";
}

function approvalStatus(approval: CreateApprovalRecordInput["approval"]): ApprovalRecord["status"] {
  if (!approval) return "pending";
  return approval.approved ? "approved" : "rejected";
}

export function actionCapability(input: {
  capabilityId: string;
  capabilityVersion?: string;
}): CapabilityManifest {
  return {
    autonomy_tier: "A0",
    authorization: {
      permissions: ["audit.synthetic"],
      requires_user_context: false,
      tenant_scoped: false
    },
    capability_type: "compute",
    id: input.capabilityId,
    input_schema: { type: "object" },
    lifecycle: {
      audit: true,
      approve: false,
      commit: false,
      prepare: false,
      preview: false,
      verify: false
    },
    model_description: "Synthetic audit capability reference.",
    name: input.capabilityId,
    observability: {
      log_inputs: "none",
      log_outputs: "none"
    },
    output_schema: { type: "object" },
    policy: {
      approval_required: false
    },
    risk_tier: "none",
    schema_version: "1.0",
    side_effects: {
      charges_money: false,
      changes_permissions: false,
      creates_records: false,
      deletes_records: false,
      irreversible: false,
      reads_data: false,
      refunds_money: false,
      sends_external_messages: false,
      triggers_external_workflow: false,
      updates_records: false,
      writes_data: false
    },
    status: "active",
    summary: "Synthetic audit capability reference.",
    version: input.capabilityVersion ?? "1.0.0"
  };
}
