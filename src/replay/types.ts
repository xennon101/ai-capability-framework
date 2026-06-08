import type {
  ActionRecord,
  ApprovalRecord,
  PolicyDecisionRecord,
  RedactionSummary
} from "../audit/index.js";
import type {
  AicfDiagnostic,
  AicfToolResultEnvelope,
  DecisionRequest,
  DecisionStatus,
  EvalCandidateResult,
  EvalCase,
  JsonObject,
  ManifestRegistry
} from "../types.js";

export type ReplayMode =
  | "deterministic_mock"
  | "provider_live"
  | "policy_only"
  | "router_only"
  | "tool_validation_only";

export type ReplayRunStatus = "passed" | "failed" | "refused";

export type ReplayStepStatus = "passed" | "failed" | "skipped";

export interface CapabilitySliceSnapshot {
  capabilityIds: string[];
  excludedCapabilityIds?: string[];
  hash?: string;
  includeRestricted?: boolean;
  maxCapabilities?: number;
}

export interface CanonicalToolCallSnapshot {
  args: JsonObject;
  argsHash: string;
  callId?: string;
  capabilityId: string;
  operation: "read" | "prepare" | "commit";
  provider?: string;
  providerToolName?: string;
}

export interface StandardToolResultSnapshot {
  actionState?: string;
  callId?: string;
  capabilityId: string;
  modelSafeEnvelope?: AicfToolResultEnvelope | JsonObject;
  policyDecision?: DecisionStatus;
  resultHash: string;
  status: AicfToolResultEnvelope["status"] | "verified";
}

export interface RedactedContextSnapshot {
  contextHash: string;
  decisionContext: DecisionRequest["context"];
  facts?: DecisionRequest["facts"];
  sourceRefs?: Array<{
    contentHash?: string;
    sourceId: string;
    sourceType: string;
    trust: string;
  }>;
  userInputSummary?: string;
}

export interface RedactedFinalResponse {
  placeholders?: string[];
  redacted?: boolean;
  text?: string;
  textHash: string;
}

export interface ReplayProviderMetadata {
  id: string;
  model?: string;
  promptTemplateVersion?: string;
}

export interface ReplayTrace {
  actions: Pick<ActionRecord, "actionId" | "actionState" | "capabilityId" | "preparedActionId" | "resultHash">[];
  approvals?: Pick<ApprovalRecord, "approvalRecordId" | "capabilityId" | "preparedActionId" | "requiredReasonCodes" | "status">[];
  capabilitySlice: CapabilitySliceSnapshot;
  capabilityVersions: Record<string, string>;
  context: RedactedContextSnapshot;
  createdAt: string;
  extensions?: Record<string, unknown>;
  finalResponse?: RedactedFinalResponse;
  policyDecisions: Array<Pick<PolicyDecisionRecord, "capabilityId" | "decision" | "decisionId" | "operation" | "reasons">>;
  provider?: ReplayProviderMetadata;
  redaction: RedactionSummary;
  runId: string;
  runtimeVersion?: string;
  schemaVersion: "1.0";
  toolCalls: CanonicalToolCallSnapshot[];
  toolResults: StandardToolResultSnapshot[];
  traceId: string;
}

export interface ReplayStepResult {
  actual?: unknown;
  expected?: unknown;
  message: string;
  name: string;
  status: ReplayStepStatus;
}

export interface ReplayResult {
  diagnostics: AicfDiagnostic[];
  extensions?: Record<string, unknown>;
  mode: ReplayMode;
  schemaVersion: "1.0";
  status: ReplayRunStatus;
  steps: ReplayStepResult[];
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
  };
  traceId: string;
}

export interface ReplayTraceRecorderInput {
  actions?: ReplayTrace["actions"];
  approvals?: ReplayTrace["approvals"];
  capabilitySlice: CapabilitySliceSnapshot;
  capabilityVersions: Record<string, string>;
  context: RedactedContextSnapshot;
  createdAt?: string;
  finalResponse?: RedactedFinalResponse;
  policyDecisions?: ReplayTrace["policyDecisions"];
  provider?: ReplayProviderMetadata;
  redaction?: RedactionSummary;
  runId: string;
  runtimeVersion?: string;
  toolCalls?: CanonicalToolCallSnapshot[];
  toolResults?: StandardToolResultSnapshot[];
  traceId?: string;
}

export interface ReplayTraceRecorder {
  record(input: ReplayTraceRecorderInput): ReplayTrace;
}

export interface TraceToGoldenOptions {
  capabilityUnderTest?: string;
  evalId?: string;
  includeRawContent?: boolean;
  requireReview?: boolean;
  suiteId: string;
  tags?: string[];
}

export interface RunReplayOptions {
  allowProviderLive?: boolean;
  context?: DecisionRequest["context"];
  facts?: DecisionRequest["facts"];
  mode: ReplayMode;
  providerRunner?: ReplayProviderRunner;
  registry?: ManifestRegistry;
}

export type ReplayProviderRunner = (trace: ReplayTrace, options: RunReplayOptions) => Promise<ReplayResult> | ReplayResult;

export interface ValidateReplayTraceResult {
  diagnostics: AicfDiagnostic[];
  valid: boolean;
}

export interface CreateEvalCandidateFromReplayTraceOptions {
  evalId?: string;
}

export type ReplayEvalCaseDraft = EvalCase;

export type ReplayEvalCandidateResult = EvalCandidateResult;
