import type { ErrorObject } from "ajv";
import type {
  CapabilityManifest,
  EntityManifest,
  EvalCandidateResult,
  EvalCase,
  EvalResultFixture
} from "./generated/manifest-types.js";

export type {
  CapabilityManifest,
  EntityManifest,
  EvalCandidateResult,
  EvalCase,
  EvalResultFixture
} from "./generated/manifest-types.js";

export type ManifestKind = "capability" | "entity" | "eval";

export type FixtureKind = "adapter_context" | "decision_request" | "eval_result" | "unknown";

export type AicfErrorCode =
  | "duplicate_id"
  | "invalid_context"
  | "invalid_capability_lifecycle"
  | "invalid_fixture"
  | "invalid_eval_result"
  | "invalid_input_schema"
  | "invalid_output_schema"
  | "invalid_read_side_effects"
  | "invalid_risk_tier"
  | "invalid_tool_call"
  | "missing_candidate"
  | "missing_required_audit"
  | "missing_required_idempotency"
  | "missing_reference"
  | "parse"
  | "schema"
  | "schema_validation_failed"
  | "tool_name_collision"
  | "unknown_capability_in_tool_call"
  | "unknown_committed_capability"
  | "unknown_eval_result"
  | "unknown_scorer"
  | "unsupported";

export type AicfWarningCode =
  | "capability_excluded"
  | "missing_required_approval_policy"
  | "schema_normalization"
  | "unknown_allowed_action"
  | "unknown_capability_under_test";

export interface AicfDiagnostic {
  code: AicfErrorCode | AicfWarningCode;
  path: string;
  kind?: ManifestKind;
  id?: string;
  message: string;
  details?: unknown;
}

export interface AicfSchemaDiagnostic extends AicfDiagnostic {
  code: "schema";
  details: ErrorObject;
}

export interface LoadedManifestBase<TManifest, TKind extends ManifestKind> {
  absolutePath: string;
  kind: TKind;
  manifest: TManifest;
  path: string;
}

export type LoadedCapabilityManifest = LoadedManifestBase<CapabilityManifest, "capability">;
export type LoadedEntityManifest = LoadedManifestBase<EntityManifest, "entity">;
export type LoadedEvalCase = LoadedManifestBase<EvalCase, "eval">;

export type LoadedManifest =
  | LoadedCapabilityManifest
  | LoadedEntityManifest
  | LoadedEvalCase;

export interface LoadedFixture {
  absolutePath: string;
  fixture: unknown;
  kind: FixtureKind;
  path: string;
}

export interface LoadManifestsOptions {
  path?: string;
  root?: string;
}

export interface LoadManifestsResult {
  basePath: string;
  errors: AicfDiagnostic[];
  fixtures: LoadedFixture[];
  manifests: LoadedManifest[];
  root: string;
}

export interface ValidationResult {
  errors: AicfDiagnostic[];
  valid: boolean;
  warnings: AicfDiagnostic[];
}

export interface ValidateManifestsOptions {
  reserved?: never;
}

export interface ManifestRegistry {
  capabilities: LoadedCapabilityManifest[];
  capabilityById: Map<string, LoadedCapabilityManifest>;
  entities: LoadedEntityManifest[];
  entityById: Map<string, LoadedEntityManifest>;
  evalById: Map<string, LoadedEvalCase>;
  evals: LoadedEvalCase[];
  warnings: AicfDiagnostic[];
}

export interface RegistryInspection {
  capabilitiesByRisk: Record<string, string[]>;
  capabilitiesByType: Record<string, string[]>;
  counts: {
    capabilities: number;
    entities: number;
    evals: number;
    manifests: number;
  };
  entities: string[];
  evalCoverage: Array<{
    capabilityId: string;
    golden: number;
    redTeam: number;
  }>;
  warnings: AicfDiagnostic[];
}

export type AutonomyTier = "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
export type RiskTier = CapabilityManifest["risk_tier"];

export type DecisionOperation = "select" | "prepare" | "commit";

export type DecisionStatus = "allowed" | "approval_required" | "denied";

export type DecisionReasonCode =
  | "approval_required"
  | "autonomy_exceeded"
  | "capability_not_found"
  | "deny_rule_matched"
  | "idempotency_required"
  | "lifecycle_not_supported"
  | "missing_fact"
  | "missing_args"
  | "missing_permission"
  | "missing_tenant_context"
  | "missing_user_context"
  | "risk_tier_exceeded"
  | "risk_tier_not_allowed"
  | "schema_validation_failed"
  | "status_deprecated"
  | "status_disabled"
  | "status_draft"
  | "status_experimental";

export interface DecisionReason {
  code: DecisionReasonCode;
  message: string;
  rule?: string;
}

export type DecisionFact = boolean | {
  reason?: string;
  value: boolean;
};

export interface DecisionRequest {
  args?: Record<string, unknown>;
  approval?: {
    approvalId?: string;
    approved: boolean;
  };
  capabilityId: string;
  context: {
    autonomyTier: AutonomyTier;
    allowedRiskTiers?: RiskTier[];
    permissions: string[];
    riskCeiling?: RiskTier;
    tenantId?: string;
    userId?: string;
  };
  facts?: Record<string, DecisionFact>;
  idempotencyKey?: string;
  operation: DecisionOperation;
}

export interface DecisionOptions {
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
}

export interface DecisionAuditPreview {
  capabilityId: string;
  idempotencyKey?: string;
  operation: DecisionOperation;
  reasons: DecisionReason[];
  status: DecisionStatus;
}

export interface DecisionResult {
  audit: DecisionAuditPreview;
  capabilityId: string;
  diagnostics: AicfDiagnostic[];
  lifecycle: LifecycleEvaluation;
  operation: DecisionOperation;
  policy: PolicyEvaluation;
  reasons: DecisionReason[];
  requiredApprovals: DecisionReason[];
  status: DecisionStatus;
}

export interface PolicyEvaluation {
  diagnostics: AicfDiagnostic[];
  reasons: DecisionReason[];
  requiredApprovals: DecisionReason[];
  status: DecisionStatus;
}

export interface LifecycleEvaluation {
  reasons: DecisionReason[];
  status: DecisionStatus;
}

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface OpenAIResponsesFunctionTool {
  description: string;
  name: string;
  parameters: JsonObject;
  strict: true;
  type: "function";
}

export interface AdapterToolBinding {
  autonomyTier: CapabilityManifest["autonomy_tier"];
  capabilityId: string;
  capabilityType: CapabilityManifest["capability_type"];
  inputSchema: JsonObject;
  normalizedInputSchema: JsonObject;
  path: string;
  restricted: boolean;
  riskTier: CapabilityManifest["risk_tier"];
  toolName: string;
}

export interface AdapterExcludedCapability {
  capabilityId: string;
  diagnostics: AicfDiagnostic[];
  path: string;
  reason:
    | "decision_denied"
    | "restricted"
    | "risk_tier_exceeded"
    | "risk_tier_not_allowed"
    | "status_deprecated"
    | "status_disabled"
    | "status_draft"
    | "status_experimental"
    | "tool_name_collision"
    | "unsupported_schema";
}

export type OpenAIResponsesToolBinding = AdapterToolBinding;

export type OpenAIResponsesExcludedCapability = AdapterExcludedCapability;

export interface OpenAIResponsesToolset {
  bindings: OpenAIResponsesToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: OpenAIResponsesExcludedCapability[];
  tools: OpenAIResponsesFunctionTool[];
}

export interface BuildOpenAIResponsesToolsOptions {
  context: DecisionRequest["context"];
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  includeRestricted?: boolean;
  namePrefix?: string;
}

export interface BuildAdapterToolsOptions {
  context: DecisionRequest["context"];
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  includeRestricted?: boolean;
  namePrefix?: string;
}

export interface OpenAIResponsesToolNameOptions {
  namePrefix?: string;
}

export interface OpenAIResponsesFunctionCall {
  arguments: string;
  call_id?: string;
  id?: string;
  name: string;
  type: "function_call";
}

export interface ParsedOpenAIResponsesToolCall {
  args: Record<string, unknown>;
  callId?: string;
  capabilityId: string;
  id?: string;
  toolName: string;
}

export type ParsedAdapterToolCall = ParsedOpenAIResponsesToolCall;

export interface ParseOpenAIResponsesToolCallResult {
  diagnostics: AicfDiagnostic[];
  parsed?: ParsedOpenAIResponsesToolCall;
  valid: boolean;
}

export type ParseAdapterToolCallResult = ParseOpenAIResponsesToolCallResult;

export interface AnthropicClaudeTool {
  description: string;
  input_schema: JsonObject;
  name: string;
  strict: true;
}

export interface AnthropicClaudeToolUse {
  id?: string;
  input: Record<string, unknown>;
  name: string;
  type?: "tool_use";
}

export interface AnthropicClaudeToolset {
  bindings: AdapterToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  tools: AnthropicClaudeTool[];
}

export type BuildAnthropicClaudeToolsOptions = BuildAdapterToolsOptions;

export interface AnthropicClaudeToolNameOptions {
  namePrefix?: string;
}

export type ParsedAnthropicClaudeToolUse = ParsedAdapterToolCall;

export type ParseAnthropicClaudeToolUseResult = ParseAdapterToolCallResult;

export interface GeminiFunctionDeclaration {
  description: string;
  name: string;
  parameters: JsonObject;
}

export interface GeminiFunctionCall {
  args?: Record<string, unknown>;
  id?: string;
  name: string;
}

export interface GeminiFunctionDeclarationSet {
  bindings: AdapterToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  functionDeclarations: GeminiFunctionDeclaration[];
}

export type BuildGeminiFunctionDeclarationsOptions = BuildAdapterToolsOptions;

export interface GeminiFunctionNameOptions {
  namePrefix?: string;
}

export type ParsedGeminiFunctionCall = ParsedAdapterToolCall;

export type ParseGeminiFunctionCallResult = ParseAdapterToolCallResult;

export interface AiSdkTool {
  description: string;
  inputSchema: JsonObject;
  strict: true;
}

export interface AiSdkToolCall {
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  toolCallId?: string;
  toolName: string;
}

export interface AiSdkToolset {
  bindings: AdapterToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  tools: Record<string, AiSdkTool>;
}

export type BuildAiSdkToolsOptions = BuildAdapterToolsOptions;

export interface AiSdkToolNameOptions {
  namePrefix?: string;
}

export type ParsedAiSdkToolCall = ParsedAdapterToolCall;

export type ParseAiSdkToolCallResult = ParseAdapterToolCallResult;

export interface McpToolDescriptor {
  annotations?: {
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
  description: string;
  inputSchema: JsonObject;
  name: string;
  outputSchema?: JsonObject;
  title: string;
}

export interface McpToolCall {
  method?: "tools/call";
  params: {
    arguments?: Record<string, unknown>;
    name: string;
  };
}

export interface McpToolDescriptorSet {
  bindings: AdapterToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  tools: McpToolDescriptor[];
}

export type BuildMcpToolDescriptorsOptions = BuildAdapterToolsOptions;

export interface McpToolNameOptions {
  namePrefix?: string;
}

export type ParsedMcpToolCall = ParsedAdapterToolCall;

export type ParseMcpToolCallResult = ParseAdapterToolCallResult;

export interface LangChainToolDescriptor {
  description: string;
  metadata: {
    autonomyTier: CapabilityManifest["autonomy_tier"];
    capabilityId: string;
    capabilityType: CapabilityManifest["capability_type"];
    restricted: boolean;
    riskTier: CapabilityManifest["risk_tier"];
  };
  name: string;
  schema: JsonObject;
}

export interface LangChainToolCall {
  args?: Record<string, unknown>;
  id?: string;
  name: string;
}

export interface LangChainToolDescriptorSet {
  bindings: AdapterToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  tools: LangChainToolDescriptor[];
}

export type BuildLangChainToolDescriptorsOptions = BuildAdapterToolsOptions;

export interface LangChainToolNameOptions {
  namePrefix?: string;
}

export type ParsedLangChainToolCall = ParsedAdapterToolCall;

export type ParseLangChainToolCallResult = ParseAdapterToolCallResult;

export interface SemanticKernelFunction {
  description: string;
  metadata: {
    autonomyTier: CapabilityManifest["autonomy_tier"];
    capabilityId: string;
    capabilityType: CapabilityManifest["capability_type"];
    restricted: boolean;
    riskTier: CapabilityManifest["risk_tier"];
  };
  name: string;
  parameters: JsonObject;
  pluginName: string;
}

export interface SemanticKernelFunctionCall {
  arguments?: Record<string, unknown>;
  functionName?: string;
  id?: string;
  name?: string;
}

export interface SemanticKernelFunctionSet {
  bindings: AdapterToolBinding[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  functions: SemanticKernelFunction[];
}

export type BuildSemanticKernelFunctionsOptions = BuildAdapterToolsOptions;

export interface SemanticKernelFunctionNameOptions {
  namePrefix?: string;
}

export type ParsedSemanticKernelFunctionCall = ParsedAdapterToolCall;

export type ParseSemanticKernelFunctionCallResult = ParseAdapterToolCallResult;

export type EvalRunStatus = "passed" | "failed";

export interface LoadEvalResultsResult {
  absolutePath: string;
  errors: AicfDiagnostic[];
  fixture?: EvalResultFixture;
  path: string;
  results: EvalCandidateResult[];
}

export interface EvalScorerResult {
  actual?: unknown;
  diagnostics: AicfDiagnostic[];
  expected?: unknown;
  message: string;
  passed: boolean;
  scorer: string;
}

export interface EvalCaseResult {
  candidate?: EvalCandidateResult;
  diagnostics: AicfDiagnostic[];
  evalId: string;
  passed: boolean;
  scorers: EvalScorerResult[];
  status: EvalRunStatus;
}

export interface EvalSuiteResult {
  diagnostics: AicfDiagnostic[];
  evals: EvalCaseResult[];
  passed: boolean;
  status: EvalRunStatus;
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
}

export interface RunEvalSuiteOptions {
  evalIds?: string[];
}

export interface SelectCapabilitySliceInput {
  allowedCapabilityTypes?: CapabilityManifest["capability_type"][];
  allowedRiskTiers?: RiskTier[];
  capabilityIds?: string[];
  context: DecisionRequest["context"];
  domains?: string[];
  entities?: string[];
  includeDeprecated?: boolean;
  includeDisabledForTests?: boolean;
  includeDraft?: boolean;
  includeExperimental?: boolean;
  includeRestricted?: boolean;
  maxCapabilities?: number;
  registry: ManifestRegistry;
  riskCeiling?: RiskTier;
  tags?: string[];
}

export interface CapabilitySlice {
  capabilities: LoadedCapabilityManifest[];
  diagnostics: AicfDiagnostic[];
  excluded: AdapterExcludedCapability[];
  registry: ManifestRegistry;
}

export interface AicfEvidenceRef {
  confidence?: "low" | "medium" | "high";
  quote?: string;
  source_id: string;
  source_type?: string;
  span_id?: string;
}

export interface AicfPolicyDecisionSummary {
  reasons?: Array<{
    code: string;
    message: string;
    rule?: string;
  }>;
  status: DecisionStatus;
}

export interface AicfPreparedActionSummary {
  action_state: "none" | "prepared" | "approval_required" | "committed" | "denied" | "refused";
  approval_required?: boolean;
  prepared_action_id?: string;
  preview?: unknown;
}

export interface AicfToolResultEnvelope<TData = unknown> {
  action?: AicfPreparedActionSummary;
  capability_id: string;
  capability_version: string;
  data?: TData;
  evidence?: AicfEvidenceRef[];
  policy?: AicfPolicyDecisionSummary;
  private_diagnostics?: unknown;
  schema_version: "1.0";
  status: "ok" | "unavailable" | "denied" | "approval_required" | "error";
  user_message?: string;
}
