import type {
  AutonomyTier,
  CapabilityManifest,
  DecisionOperation,
  DecisionStatus,
  RiskTier
} from "../types.js";
import type {
  AicfApprovalDecision,
  AicfPolicyDecision,
  AicfPreparedAction,
  AicfRuntimeContext
} from "../runtime/types.js";

export type AuditDiagnosticMode = "redacted" | "unsafe_unredacted";

export interface RedactionSummary {
  fieldsRedacted: string[];
  hashAlgorithm: "sha256";
  mode: AuditDiagnosticMode;
}

export interface RedactedSubjectRef {
  actorType?: string;
  refHash: string;
}

export interface RedactedAccountRef {
  refHash: string;
}

export interface RedactedTenantRef {
  refHash: string;
}

export interface TraceRef {
  provider?: string;
  traceId: string;
}

export interface ResultRef {
  resultHash: string;
  resultType?: string;
}

export interface PolicySourceRef {
  source: "aicf" | "auth_platform" | "host" | "policy_engine";
  version?: string;
}

export interface AuditReason {
  code: string;
  message: string;
  ruleId?: string;
  severity?: string;
  source?: string;
}

export type LedgerOperation = "select" | "read" | "prepare" | "approve" | "commit";

export interface PolicyDecisionRecord {
  accountRef?: RedactedAccountRef;
  autonomyTier: AutonomyTier;
  capabilityId: string;
  capabilityVersion: string;
  createdAt: string;
  decision: DecisionStatus;
  decisionId: string;
  inputHash: string;
  operation: LedgerOperation;
  policySource: PolicySourceRef;
  reasons: AuditReason[];
  redaction: RedactionSummary;
  riskTier: RiskTier;
  runId: string;
  schemaVersion: "1.0";
  selectedCapabilitySliceHash?: string;
  subjectRef?: RedactedSubjectRef;
  tenantRef?: RedactedTenantRef;
  traceRef?: TraceRef;
}

export type ActionRecordState =
  | "proposed"
  | "prepared"
  | "approval_required"
  | "approved"
  | "rejected"
  | "committing"
  | "committed"
  | "failed"
  | "expired"
  | "cancelled";

export interface ActionRecord {
  actionId: string;
  actionState: ActionRecordState;
  approvalRecordId?: string;
  auditRefs: string[];
  capabilityId: string;
  capabilityVersion: string;
  createdAt: string;
  expiresAt?: string;
  idempotencyKeyHash?: string;
  inputHash: string;
  policyDecisionId?: string;
  preparedActionId?: string;
  previewHash?: string;
  resultHash?: string;
  runId: string;
  schemaVersion: "1.0";
  traceRef?: TraceRef;
  updatedAt: string;
}

export interface ApprovalRecord {
  approvalRecordId: string;
  capabilityId: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: RedactedSubjectRef;
  decisionReason?: string;
  expiresAt?: string;
  preparedActionId: string;
  requestedBy: RedactedSubjectRef;
  requiredReasonCodes: string[];
  schemaVersion: "1.0";
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  traceRef?: TraceRef;
}

export interface IdempotencyRecord {
  completedAt?: string;
  createdAt: string;
  expiresAt?: string;
  idempotencyRecordId: string;
  keyHash: string;
  metadataHash?: string;
  resultRef?: ResultRef;
  schemaVersion: "1.0";
  scopeHash: string;
  status: "reserved" | "completed";
}

export interface PolicyDecisionFilter {
  capabilityId?: string;
  decision?: DecisionStatus;
  runId?: string;
}

export interface ActionFilter {
  actionState?: ActionRecordState;
  capabilityId?: string;
  preparedActionId?: string;
  runId?: string;
}

export interface ApprovalFilter {
  capabilityId?: string;
  preparedActionId?: string;
  status?: ApprovalRecord["status"];
}

export interface IdempotencyFilter {
  keyHash?: string;
  scopeHash?: string;
  status?: IdempotencyRecord["status"];
}

export interface PolicyDecisionStore {
  getDecision(decisionId: string): Promise<PolicyDecisionRecord | null>;
  listDecisions(filter?: PolicyDecisionFilter): Promise<PolicyDecisionRecord[]>;
  putDecision(record: PolicyDecisionRecord): Promise<void>;
}

export interface ActionStore {
  getAction(actionId: string): Promise<ActionRecord | null>;
  listActions(filter?: ActionFilter): Promise<ActionRecord[]>;
  putAction(record: ActionRecord): Promise<void>;
  updateAction(actionId: string, patch: Partial<ActionRecord>): Promise<ActionRecord>;
}

export interface ApprovalLedgerStore {
  getApproval(approvalRecordId: string): Promise<ApprovalRecord | null>;
  listApprovals(filter?: ApprovalFilter): Promise<ApprovalRecord[]>;
  putApproval(record: ApprovalRecord): Promise<void>;
  updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): Promise<ApprovalRecord>;
}

export interface IdempotencyLedgerStore {
  complete(key: string, scope: string, resultRef: ResultRef): Promise<void>;
  get(key: string, scope: string): Promise<IdempotencyRecord | null>;
  listIdempotencyRecords(filter?: IdempotencyFilter): Promise<IdempotencyRecord[]>;
  reserve(key: string, metadata: IdempotencyMetadata): Promise<IdempotencyReservation>;
}

export interface IdempotencyMetadata {
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  scope: string;
}

export type IdempotencyReservation =
  | { record: IdempotencyRecord; reserved: true }
  | { record: IdempotencyRecord; reserved: false };

export interface CreatePolicyDecisionRecordInput {
  args?: Record<string, unknown>;
  capability: CapabilityManifest;
  createdAt?: string;
  decisionId?: string;
  diagnosticMode?: AuditDiagnosticMode;
  operation: LedgerOperation;
  policyDecision: AicfPolicyDecision;
  runtimeContext: AicfRuntimeContext;
  selectedCapabilitySliceHash?: string;
  traceRef?: TraceRef;
}

export interface CreateActionRecordInput {
  actionId?: string;
  actionState: ActionRecordState;
  args?: Record<string, unknown>;
  auditRefs?: string[];
  capability: CapabilityManifest;
  createdAt?: string;
  expiresAt?: string;
  idempotencyKey?: string;
  policyDecisionId?: string;
  preparedActionId?: string;
  preview?: unknown;
  result?: unknown;
  runId: string;
  traceRef?: TraceRef;
  updatedAt?: string;
}

export interface CreateApprovalRecordInput {
  approval?: AicfApprovalDecision;
  approvalRecordId?: string;
  capabilityId: string;
  createdAt?: string;
  diagnosticMode?: AuditDiagnosticMode;
  preparedActionId: string;
  requestedBy: AicfRuntimeContext["subject"];
  requiredReasonCodes?: string[];
  runtimeContext?: AicfRuntimeContext;
  status?: ApprovalRecord["status"];
  traceRef?: TraceRef;
}

export interface CreateIdempotencyRecordInput {
  createdAt?: string;
  expiresAt?: string;
  key: string;
  metadata?: Record<string, unknown>;
  resultRef?: ResultRef;
  scope: string;
  status?: IdempotencyRecord["status"];
}

export interface RuntimePolicyDecisionLedgerInput {
  args?: Record<string, unknown>;
  capability: CapabilityManifest;
  operation: LedgerOperation;
  policyDecision: AicfPolicyDecision;
  runtimeContext: AicfRuntimeContext;
  selectedCapabilitySliceHash?: string;
  traceRef?: TraceRef;
}

export interface RuntimeActionLedgerInput {
  actionId?: string;
  actionState: ActionRecordState;
  args?: Record<string, unknown>;
  auditRefs?: string[];
  capability: CapabilityManifest;
  expiresAt?: string;
  idempotencyKey?: string;
  policyDecisionId?: string;
  preparedAction?: AicfPreparedAction;
  preparedActionId?: string;
  preview?: unknown;
  result?: unknown;
  runId: string;
  traceRef?: TraceRef;
}

export interface RuntimeApprovalLedgerInput {
  approval?: AicfApprovalDecision;
  capabilityId: string;
  preparedAction: AicfPreparedAction;
  requiredReasonCodes?: string[];
  runtimeContext: AicfRuntimeContext;
  status?: ApprovalRecord["status"];
  traceRef?: TraceRef;
}

export interface RuntimeIdempotencyLedgerInput {
  expiresAt?: string;
  key: string;
  metadata?: Record<string, unknown>;
  resultRef?: ResultRef;
  scope: string;
  status?: IdempotencyRecord["status"];
}

export interface AicfRuntimeLedgerRecorder {
  recordAction(input: RuntimeActionLedgerInput): Promise<ActionRecord> | ActionRecord;
  recordApproval(input: RuntimeApprovalLedgerInput): Promise<ApprovalRecord> | ApprovalRecord;
  recordIdempotency(input: RuntimeIdempotencyLedgerInput): Promise<IdempotencyRecord> | IdempotencyRecord;
  recordPolicyDecision(input: RuntimePolicyDecisionLedgerInput): Promise<PolicyDecisionRecord> | PolicyDecisionRecord;
  updateAction(actionId: string, patch: Partial<ActionRecord>): Promise<ActionRecord> | ActionRecord;
}
