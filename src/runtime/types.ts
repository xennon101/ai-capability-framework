import type { CapabilityManifest } from "../generated/manifest-types.js";
import type {
  DecisionOperation,
  DecisionRequest,
  DecisionStatus,
  JsonObject,
  JsonValue,
  LoadedCapabilityManifest,
  ManifestRegistry,
  RiskTier
} from "../types.js";

export type {
  JsonObject,
  JsonValue,
  LoadedCapabilityManifest,
  ManifestRegistry
} from "../types.js";

export type AicfRuntimeEnvironment = "development" | "test" | "staging" | "production";

export interface AicfSubjectContext {
  actorType: "user" | "operator" | "service" | "system";
  displayName?: string;
  emailHash?: string;
  entitlements?: string[];
  permissions: string[];
  roles: string[];
  userId: string;
}

export interface AicfAccountContext {
  accountId: string;
  dataResidency?: string;
  plan?: string;
  region?: string;
  riskFlags?: string[];
  subscriptionStatus?: "active" | "trialing" | "past_due" | "cancelled" | "suspended" | "unknown";
  tenantId: string;
}

export interface AicfWorkflowContext {
  currentEntityId?: string;
  currentEntityType?: string;
  locale?: string;
  pageOrSurface?: string;
  timezone?: string;
  workflowId?: string;
  workflowType?: string;
}

export interface AicfAutonomyContext {
  allowExternalMessages: boolean;
  allowMoneyMovement: boolean;
  allowPermissionChanges: boolean;
  allowSideEffects: boolean;
  autonomyTier: DecisionRequest["context"]["autonomyTier"];
  maxRiskTier: Exclude<RiskTier, "none">;
}

export interface AicfRuntimeContext {
  account: AicfAccountContext;
  autonomy: AicfAutonomyContext;
  environment: AicfRuntimeEnvironment;
  facts: Record<string, unknown>;
  metadata: Record<string, unknown>;
  requestId: string;
  runId: string;
  startedAt: string;
  subject: AicfSubjectContext;
  workflow?: AicfWorkflowContext;
}

export interface AicfRuntimeUserInput {
  attachments?: Array<{
    id: string;
    label?: string;
    mediaType: string;
  }>;
  metadata?: Record<string, unknown>;
  text: string;
}

export interface AicfRuntimeWarning {
  code: string;
  details?: unknown;
  message: string;
}

export interface AicfContextItem {
  data?: Record<string, unknown>;
  dataClasses?: string[];
  id: string;
  kind: "entity" | "document" | "fact" | "workflow" | "policy" | "message_summary";
  source?: {
    freshness?: "live" | "recent" | "stale" | "unknown";
    id?: string;
    label?: string;
    type: "app" | "document" | "api" | "database" | "user" | "system";
  };
  text?: string;
  title?: string;
  trusted: boolean;
  visibleToModel: boolean;
}

export interface AicfRedaction {
  itemId?: string;
  path?: string;
  reason: string;
}

export interface AicfBuiltContext {
  items: AicfContextItem[];
  modelContextText: string;
  redactions: AicfRedaction[];
  runtimeContext: AicfRuntimeContext;
  warnings: AicfRuntimeWarning[];
}

export interface AicfContextBuilderInput {
  baseContext: AicfRuntimeContext;
  registry: ManifestRegistry;
  userInput: AicfRuntimeUserInput;
}

export interface AicfContextBuilder {
  build(input: AicfContextBuilderInput): Promise<AicfBuiltContext>;
}

export interface AicfAuthPlatformAdapter {
  getCapabilityPermissions(input: {
    account: AicfAccountContext;
    capabilityIds: string[];
    subject: AicfSubjectContext;
  }): Promise<Record<string, {
    allowed: boolean;
    permissions: string[];
    reason?: string;
  }>>;

  getEntitlements(input: {
    account: AicfAccountContext;
    subject: AicfSubjectContext;
  }): Promise<string[]>;

  resolveAccount(input: {
    accountId?: string;
    metadata?: Record<string, unknown>;
    subject: AicfSubjectContext;
    tenantId?: string;
  }): Promise<AicfAccountContext>;

  resolveSubject(input: {
    metadata?: Record<string, unknown>;
    servicePrincipalId?: string;
    sessionToken?: string;
    userId?: string;
  }): Promise<AicfSubjectContext>;
}

export interface AicfRedactionPolicy {
  redact(input: {
    item: AicfContextItem;
    runtimeContext: AicfRuntimeContext;
  }): { item: AicfContextItem; redactions: AicfRedaction[] };
}

export interface CapabilityRouteRequest {
  allowedCapabilityTypes?: CapabilityManifest["capability_type"][];
  allowedDomains?: string[];
  builtContext: AicfBuiltContext;
  capabilityPermissions?: Record<string, {
    allowed: boolean;
    permissions: string[];
    reason?: string;
  }>;
  excludeCapabilityIds?: string[];
  includeCapabilityIds?: string[];
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  includeRestricted?: boolean;
  maxCapabilities?: number;
  maxRiskTier?: Exclude<RiskTier, "none">;
  registry: ManifestRegistry;
  userInput: AicfRuntimeUserInput;
}

export interface CapabilitySliceItem {
  capabilityId: string;
  exposedOperations: Array<"select" | "prepare">;
  reasons: string[];
  score: number;
}

export interface RuntimeCapabilitySlice {
  excluded: Array<{
    capabilityId: string;
    reason: string;
  }>;
  items: CapabilitySliceItem[];
  warnings: AicfRuntimeWarning[];
}

export type CapabilitySlice = RuntimeCapabilitySlice;

export interface AicfCapabilityRouter {
  route(request: CapabilityRouteRequest): Promise<CapabilitySlice> | CapabilitySlice;
}

export interface AicfApprovalRequirement {
  approvalType: "user_confirmation" | "operator_review" | "admin_review" | "external_workflow";
  expiresAt?: string;
  reason: string;
  requiredRole?: string;
}

export interface AicfApprovalDecision {
  approvalId: string;
  approved: boolean;
  decidedBy?: {
    actorId: string;
    actorType: AicfSubjectContext["actorType"];
  };
  decidedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  preparedActionId?: string;
  reason?: string;
}

export type AicfActionState =
  | "proposed"
  | "prepared"
  | "approval_pending"
  | "approved"
  | "rejected"
  | "committed"
  | "verified"
  | "failed"
  | "expired"
  | "cancelled";

export interface AicfPreparedActionPreview {
  data: Record<string, unknown>;
  expiresAt?: string;
  riskTier?: Exclude<RiskTier, "none">;
  summary: string;
  userMessage?: string;
}

export interface AicfPreparedAction {
  accountId: string;
  argsHash: string;
  argsRedacted: Record<string, unknown>;
  capabilityId: string;
  capabilityVersion?: string;
  createdAt: string;
  expiresAt: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  policyDecision: AicfPolicyDecision;
  preview: AicfPreparedActionPreview;
  preparedActionId: string;
  requestId: string;
  runId: string;
  state: AicfActionState;
  subjectId: string;
  tenantId: string;
  updatedAt: string;
}

export interface AicfCommitResult {
  committedActionId: string;
  data?: Record<string, unknown>;
  externalReferences?: Array<{
    id: string;
    system: string;
    type?: string;
  }>;
  status: "committed" | "failed";
  userMessage?: string;
}

export interface AicfCommittedAction {
  accountId: string;
  capabilityId: string;
  committedActionId: string;
  committedAt: string;
  preparedActionId: string;
  requestId: string;
  result: AicfCommitResult;
  runId: string;
  state: "committed" | "verified" | "failed";
  subjectId: string;
  tenantId: string;
}

export interface AicfVerificationResult {
  data?: Record<string, unknown>;
  message?: string;
  status: "verified" | "failed" | "not_supported";
}

export type AicfPolicyDecisionStatus = DecisionStatus;

export interface AicfPolicyReason {
  code: string;
  message: string;
  ruleId?: string;
  severity: "info" | "warning" | "error";
  source: "aicf" | "auth_platform" | "host" | "policy_engine";
}

export interface AicfPolicyDecision {
  diagnostics?: Record<string, unknown>;
  policyVersion?: string;
  reasons: AicfPolicyReason[];
  requiredApprovals: AicfApprovalRequirement[];
  status: AicfPolicyDecisionStatus;
}

export interface AicfPolicyEvaluationInput {
  approval?: AicfApprovalDecision;
  args?: Record<string, unknown>;
  builtContext?: AicfBuiltContext;
  capability: LoadedCapabilityManifest;
  facts?: DecisionRequest["facts"];
  idempotencyKey?: string;
  operation: DecisionOperation;
  preparedAction?: AicfPreparedAction;
  runtimeContext: AicfRuntimeContext;
}

export interface AicfPolicyBroker {
  evaluate(input: AicfPolicyEvaluationInput): Promise<AicfPolicyDecision> | AicfPolicyDecision;
}

export type AicfHostPolicyHook =
  (input: AicfPolicyEvaluationInput) => Promise<AicfPolicyDecision | null> | AicfPolicyDecision | null;

export type AicfRuntimeErrorCode =
  | "runtime_context_invalid"
  | "capability_not_found"
  | "capability_not_available"
  | "capability_not_in_slice"
  | "schema_validation_failed"
  | "policy_denied"
  | "approval_required"
  | "approval_missing"
  | "approval_rejected"
  | "approval_expired"
  | "idempotency_conflict"
  | "handler_not_found"
  | "handler_failed"
  | "output_schema_validation_failed"
  | "provider_error"
  | "turn_limit_exceeded"
  | "tool_limit_exceeded"
  | "optional_dependency_missing";

export type AicfToolResultStatus =
  | "success"
  | "unavailable"
  | "validation_error"
  | "denied"
  | "approval_required"
  | "prepared"
  | "committed"
  | "failed";

export type AicfToolResultOperation = "select" | "read" | "prepare" | "commit" | "verify";

export interface AicfRuntimeEnvelopeError {
  code: string;
  message: string;
  path?: string;
}

export interface AicfRuntimeToolResultEnvelope<TData = unknown> {
  action?: {
    approvalRequired?: boolean;
    committedActionId?: string;
    expiresAt?: string;
    preparedActionId?: string;
    state?: AicfActionState | string;
  };
  capabilityId: string;
  capabilityVersion?: string;
  data?: TData;
  diagnostics?: Record<string, unknown>;
  errors?: AicfRuntimeEnvelopeError[];
  evidence?: Array<{
    label?: string;
    quote?: string;
    sourceId: string;
    sourceType: string;
  }>;
  operation: AicfToolResultOperation;
  policy?: {
    reasons: AicfPolicyReason[];
    requiredApprovals: AicfApprovalRequirement[];
    status: AicfPolicyDecisionStatus;
  };
  requestId: string;
  runId: string;
  schemaVersion: "1.0";
  status: AicfToolResultStatus;
  userMessage?: string;
}

export interface CreateToolEnvelopeInput<TData = unknown>
  extends Omit<AicfRuntimeToolResultEnvelope<TData>, "schemaVersion"> {}

export interface ModelSafeEnvelopeOptions {
  environment?: AicfRuntimeEnvironment;
  includeDiagnosticsForModel?: boolean;
}

export interface BuildRuntimeContextInput {
  account?: {
    accountId?: string;
    metadata?: Record<string, unknown>;
    tenantId?: string;
  };
  adapter: AicfAuthPlatformAdapter;
  autonomy?: Partial<AicfAutonomyContext>;
  environment: AicfRuntimeEnvironment;
  facts?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestId?: string;
  runId?: string;
  startedAt?: string;
  subject?: {
    metadata?: Record<string, unknown>;
    servicePrincipalId?: string;
    sessionToken?: string;
    userId?: string;
  };
  workflow?: AicfWorkflowContext;
}

export interface AicfCapabilityHandler<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown> {
  capabilityId: string;
  commit?: (input: {
    approval: AicfApprovalDecision;
    preparedAction: AicfPreparedAction;
    runtimeContext: AicfRuntimeContext;
  }) => Promise<AicfCommitResult> | AicfCommitResult;
  prepare?: (input: {
    args: TInput;
    builtContext: AicfBuiltContext;
    runtimeContext: AicfRuntimeContext;
  }) => Promise<AicfPreparedActionPreview> | AicfPreparedActionPreview;
  read?: (input: {
    args: TInput;
    builtContext: AicfBuiltContext;
    runtimeContext: AicfRuntimeContext;
  }) => Promise<TOutput> | TOutput;
  verify?: (input: {
    committedAction: AicfCommittedAction;
    runtimeContext: AicfRuntimeContext;
  }) => Promise<AicfVerificationResult> | AicfVerificationResult;
}

export interface AicfPreparedActionStore {
  create(action: AicfPreparedAction): Promise<void>;
  get(preparedActionId: string): Promise<AicfPreparedAction | undefined>;
  updateState(input: {
    expectedState?: AicfActionState;
    nextState: AicfActionState;
    preparedActionId: string;
    updatedAt: string;
  }): Promise<void>;
}

export interface AicfApprovalStore {
  create(decision: AicfApprovalDecision): Promise<void>;
  get(approvalId: string): Promise<AicfApprovalDecision | undefined>;
  getForPreparedAction(preparedActionId: string): Promise<AicfApprovalDecision[]>;
}

export interface AicfIdempotencyStore {
  complete(input: {
    key: string;
    result: Record<string, unknown>;
    scope: string;
  }): Promise<void>;
  reserve(input: {
    expiresAt: string;
    key: string;
    metadata?: Record<string, unknown>;
    scope: string;
  }): Promise<{ reserved: true } | { existing?: Record<string, unknown>; reserved: false }>;
}

export interface AicfAuditEvent {
  actionState?: AicfActionState;
  capabilityId?: string;
  createdAt: string;
  details?: Record<string, unknown>;
  eventId: string;
  message?: string;
  operation?: AicfToolResultOperation;
  preparedActionId?: string;
  requestId: string;
  runId: string;
  status: "attempted" | "allowed" | "denied" | "approval_required" | "succeeded" | "failed";
  type:
    | "tool_execution"
    | "action_prepare"
    | "approval_record"
    | "action_commit"
    | "action_verify";
}

export interface AicfAuditSink {
  write(event: AicfAuditEvent): Promise<void> | void;
}

export interface AicfActionLifecycleManagerOptions {
  approvalStore: AicfApprovalStore;
  auditSink?: AicfAuditSink;
  handlers: {
    get(capabilityId: string): AicfCapabilityHandler | undefined;
  };
  idempotencyStore: AicfIdempotencyStore;
  policyBroker: AicfPolicyBroker;
  preparedActionStore: AicfPreparedActionStore;
  registry: ManifestRegistry;
}

export interface AicfPrepareActionInput {
  args: Record<string, unknown>;
  builtContext: AicfBuiltContext;
  capabilityId: string;
  idempotencyKey?: string;
  runtimeContext: AicfRuntimeContext;
}

export interface AicfRecordApprovalInput {
  approvalId?: string;
  approved: boolean;
  decidedAt?: string;
  decidedBy?: {
    actorId: string;
    actorType: AicfSubjectContext["actorType"];
  };
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  preparedActionId: string;
  reason?: string;
  runtimeContext: AicfRuntimeContext;
}

export interface AicfCommitActionInput {
  approval?: AicfApprovalDecision;
  approvalId?: string;
  builtContext?: AicfBuiltContext;
  commitCapabilityId?: string;
  idempotencyKey?: string;
  preparedActionId: string;
  runtimeContext: AicfRuntimeContext;
}

export interface AicfToolExecutionRequest {
  args: Record<string, unknown>;
  builtContext: AicfBuiltContext;
  capabilityId: string;
  idempotencyKey?: string;
  operation: "read" | "prepare";
  runtimeContext: AicfRuntimeContext;
  source: "model_tool_call" | "host_call" | "test";
}

export interface AicfToolExecutorOptions {
  actionLifecycle: {
    prepare(input: AicfPrepareActionInput): Promise<AicfRuntimeToolResultEnvelope>;
  };
  auditSink?: AicfAuditSink;
  handlers: {
    get(capabilityId: string): AicfCapabilityHandler | undefined;
  };
  includeDiagnosticsForModel?: boolean;
  policyBroker: AicfPolicyBroker;
  registry: ManifestRegistry;
  throwOnMissingHandler?: boolean;
}
