/*
 * Generated from schemas/*.schema.json.
 * Do not edit by hand. Run `npm run generate:types`.
 */
export interface AdapterContextFixture {
  autonomyTier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  permissions: string[];
  tenantId?: string;
  userId?: string;
  riskCeiling?: "none" | "low" | "medium" | "high" | "critical";
  /**
   * @minItems 1
   */
  allowedRiskTiers?: [
    "none" | "low" | "medium" | "high" | "critical",
    ...("none" | "low" | "medium" | "high" | "critical")[]
  ];
}

export interface CapabilityManifest {
  schema_version: "1.0";
  id: string;
  version: string;
  status: "draft" | "experimental" | "active" | "deprecated" | "disabled";
  name: string;
  summary: string;
  model_description: string;
  domain?: string;
  owner?: {
    team?: string;
    contact?: string;
  };
  capability_type:
    | "read_data"
    | "retrieve_documents"
    | "compute"
    | "write_prepare_only"
    | "write_commit"
    | "external_message_prepare"
    | "external_message_send"
    | "workflow_start"
    | "workflow_step"
    | "human_handoff";
  autonomy_tier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  risk_tier: "none" | "low" | "medium" | "high" | "critical";
  when_to_use?: string[];
  when_not_to_use?: string[];
  tags?: string[];
  input_schema: JsonSchemaObject;
  output_schema: JsonSchemaObject;
  side_effects: {
    reads_data: boolean;
    writes_data: boolean;
    creates_records: boolean;
    updates_records: boolean;
    deletes_records: boolean;
    sends_external_messages: boolean;
    charges_money: boolean;
    refunds_money: boolean;
    changes_permissions: boolean;
    triggers_external_workflow: boolean;
    irreversible: boolean;
  };
  authorization: {
    /**
     * @minItems 1
     */
    permissions: [string, ...string[]];
    tenant_scoped: boolean;
    requires_user_context: boolean;
    data_scope?: string[];
  };
  policy: {
    approval_required?: boolean;
    approval_required_if?: PolicyRule[];
    deny_if?: PolicyRule[];
    max_autonomy_tier?: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  };
  lifecycle: {
    prepare: boolean;
    preview: boolean;
    approve: boolean;
    commit: boolean;
    commit_capability_id?: string;
    verify: boolean;
    audit: boolean;
  };
  idempotency?: {
    required: boolean;
    key_fields?: string[];
  };
  observability: {
    log_inputs: "none" | "summary" | "redacted";
    log_outputs: "none" | "summary" | "redacted";
    trace_attributes?: {
      [k: string]: string | number | boolean | null;
    };
  };
  evals?: {
    golden?: string[];
    red_team?: string[];
  };
  extensions?: {};
}
/**
 * This interface was referenced by `CapabilityManifest`'s JSON-Schema
 * via the `definition` "json_schema_object".
 */
export interface JsonSchemaObject {
  type: string | unknown[];
  [k: string]: unknown;
}
/**
 * This interface was referenced by `CapabilityManifest`'s JSON-Schema
 * via the `definition` "policy_rule".
 */
export interface PolicyRule {
  rule: string;
  reason: string;
  field?: string;
  missing_behavior?: "deny" | "approval_required" | "ignore";
  operator?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "exists";
  value?: unknown;
}

export interface ConformanceCaseFixture {
  id: string;
  input: string;
  provider?:
    | "openai"
    | "anthropic"
    | "gemini"
    | "ai-sdk"
    | "mcp"
    | "langchain"
    | "semantic-kernel-mcp"
    | "semantic-kernel-openapi";
  /**
   * @minItems 1
   */
  capabilityIds: [string, ...string[]];
  mockProviderResponses?: unknown[];
  expected: {
    providerToolNames?: string[];
    resultStatuses?: ("success" | "approval_required" | "denied" | "failed" | "validation_error" | "unavailable")[];
    finalTextRequiredSubstrings?: string[];
    canonicalToolCalls?: {
      capabilityId: string;
      argsSubset?: {
        [k: string]: unknown;
      };
    }[];
  };
}

/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "provider".
 */
export type Provider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ai-sdk"
  | "mcp"
  | "langchain"
  | "semantic-kernel-mcp"
  | "semantic-kernel-openapi";
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "dimension".
 */
export type Dimension =
  | "descriptor_export"
  | "tool_name_mapping"
  | "schema_normalization"
  | "schema_downgrade_reporting"
  | "tool_call_parsing"
  | "tool_arg_validation"
  | "tool_result_envelope"
  | "approval_required_behavior"
  | "commit_tool_not_exposed_by_default"
  | "risk_filtering"
  | "disabled_capability_filtering"
  | "provider_error_normalization"
  | "streaming_or_loop_semantics";

export interface ConformanceReportFixture {
  schemaVersion: "1.0";
  generatedAt: string;
  aicfVersion: string;
  providerResults: ProviderResult[];
  capabilityResults: CapabilityResult[];
  failures: Failure[];
  warnings: Warning[];
  summary: Summary;
  passed: boolean;
  counts: Counts;
  results: CaseResult[];
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "provider_result".
 */
export interface ProviderResult {
  provider: Provider;
  label: string;
  passed: boolean;
  results: number;
  failed: number;
  dimensions: {
    dimension: Dimension;
    passed: number;
    failed: number;
  }[];
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "capability_result".
 */
export interface CapabilityResult {
  capabilityId: string;
  provider: Provider;
  caseIds: string[];
  passed: boolean;
  diagnostics: string[];
  dimensions: ScorerResult[];
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "scorer_result".
 */
export interface ScorerResult {
  scorer: string;
  dimension: Dimension;
  passed: boolean;
  diagnostics: string[];
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "failure".
 */
export interface Failure {
  provider: Provider;
  caseId: string;
  capabilityId?: string;
  dimension: Dimension;
  message: string;
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "warning".
 */
export interface Warning {
  provider?: Provider;
  caseId?: string;
  dimension?: Dimension;
  message: string;
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "summary".
 */
export interface Summary {
  pass: number;
  warn: number;
  fail: number;
  providers: number;
  results: number;
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "counts".
 */
export interface Counts {
  passed: number;
  failed: number;
  providers: number;
  results: number;
}
/**
 * This interface was referenced by `ConformanceReportFixture`'s JSON-Schema
 * via the `definition` "case_result".
 */
export interface CaseResult {
  provider: Provider;
  caseId: string;
  capabilityIds: string[];
  passed: boolean;
  diagnostics: string[];
  dimensions: ScorerResult[];
  scorers: ScorerResult[];
  exportResult?: unknown;
}

export interface ProviderTargetMatrixFixture {
  schemaVersion: "1.0";
  generatedAt: string;
  targets: {
    provider:
      | "openai"
      | "anthropic"
      | "gemini"
      | "ai-sdk"
      | "mcp"
      | "langchain"
      | "semantic-kernel-mcp"
      | "semantic-kernel-openapi";
    canonicalProvider:
      | "openai"
      | "anthropic"
      | "gemini"
      | "ai-sdk"
      | "mcp"
      | "langchain"
      | "semantic-kernel-mcp"
      | "semantic-kernel-openapi";
    label: string;
    adapterKind: "descriptor" | "openapi";
    runtimeBoundary: "descriptor_only" | "bounded_loop" | "host_framework_bridge" | "openapi_metadata";
    requiresContext: boolean;
    requiresServerUrl: boolean;
  }[];
}

export interface DecisionRequestFixture {
  capabilityId: string;
  operation: "select" | "prepare" | "commit";
  args?: {};
  context: AdapterContext;
  facts?: {
    [k: string]:
      | boolean
      | {
          value: boolean;
          reason?: string;
        };
  };
  approval?: {
    approved: boolean;
    approvalId?: string;
  };
  idempotencyKey?: string;
}
/**
 * This interface was referenced by `DecisionRequestFixture`'s JSON-Schema
 * via the `definition` "adapter_context".
 */
export interface AdapterContext {
  autonomyTier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
  permissions: string[];
  tenantId?: string;
  userId?: string;
  riskCeiling?: "none" | "low" | "medium" | "high" | "critical";
  /**
   * @minItems 1
   */
  allowedRiskTiers?: [
    "none" | "low" | "medium" | "high" | "critical",
    ...("none" | "low" | "medium" | "high" | "critical")[]
  ];
}

export interface EntityManifest {
  schema_version: "1.0";
  id: string;
  version: string;
  name: string;
  summary: string;
  canonical_id: {
    field: string;
    pattern?: string;
  };
  data_classification: {
    default: string;
    fields?: {
      [k: string]: string;
    };
  };
  relationships?: {
    name: string;
    target_entity: string;
    cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
    lookup_capability?: string;
  }[];
  lookup: {
    primary_capability: string;
  };
  /**
   * @minItems 1
   */
  allowed_actions: [string, ...string[]];
  model_guidance: string;
  extensions?: {};
}

export interface EvalCase {
  schema_version: "1.0";
  id: string;
  name?: string;
  capability_under_test?: string;
  tags?: string[];
  input: {
    user_message: string;
    conversation?: {
      role: "user" | "assistant" | "system" | "tool";
      content: string;
    }[];
  };
  context?: {};
  expected: ExpectedBehavior;
  /**
   * @minItems 1
   */
  scorers: [
    {
      type: string;
      [k: string]: unknown;
    },
    ...{
      type: string;
      [k: string]: unknown;
    }[]
  ];
  extensions?: {};
}
/**
 * This interface was referenced by `EvalCase`'s JSON-Schema
 * via the `definition` "expected_behavior".
 */
export interface ExpectedBehavior {
  selected_capabilities?: {
    includes?: string[];
    excludes?: string[];
  };
  tool_calls?: {
    capability_id: string;
    args_match?: {};
    args_exact?: {};
    allowed_fields?: string[];
  }[];
  forbidden_tool_calls?: {
    capability_id: string;
  }[];
  tool_call_sequence?: string[];
  policy_decision?: "allowed" | "approval_required" | "denied";
  action_state?: "none" | "prepared" | "approval_required" | "committed" | "denied" | "refused";
  no_commit?: boolean;
  refusal?: {
    required: boolean;
    reason_contains?: string[];
  };
  response?: {
    must_include?: string[];
    must_not_include?: string[];
  };
}

export interface EvalResultFixture {
  schema_version: "1.0";
  results: EvalCandidateResult[];
  extensions?: {};
}
/**
 * This interface was referenced by `EvalResultFixture`'s JSON-Schema
 * via the `definition` "eval_candidate_result".
 */
export interface EvalCandidateResult {
  eval_id: string;
  selected_capabilities?: string[];
  tool_calls?: {
    capability_id: string;
    args?: {};
  }[];
  policy_decision?: "allowed" | "approval_required" | "denied";
  action_state?: "none" | "prepared" | "approval_required" | "committed" | "denied" | "refused";
  committed_capabilities?: string[];
  refusal?: {
    present?: boolean;
    reason?: string;
  };
  response?: {
    text?: string;
  };
  extensions?: {};
}

export interface BraintrustDatasetFixture {
  items: {
    expected?: {};
    id: string;
    input: {};
    metadata: {};
  }[];
  schemaVersion: "1.0";
  source: "aicf";
}

export interface OpenAIEvalDatasetFixture {
  data: {
    expected?: {};
    id: string;
    input: {
      content: string;
      role: "user";
    }[];
    metadata: {};
  }[];
  schemaVersion: "1.0";
  source: "aicf";
}

export interface EvidenceExportInputFixture {
  project: {
    id: string;
    name: string;
    environment?: string;
  };
  generatedAt?: string;
  aicfVersion?: string;
  format?: "json" | "markdown";
  incidentSummary?: {
    total?: number;
    open?: number;
    resolved?: number;
  };
  modelUpgradeHistory?: {
    changedAt: string;
    fromModel?: string;
    toModel: string;
    reason: string;
  }[];
}

/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "evidence_risk_tier".
 */
export type EvidenceRiskTier = "none" | "low" | "medium" | "high" | "critical";
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "coverage_status".
 */
export type CoverageStatus = "available" | "gap" | "not_supplied";

export interface EvidencePackFixture {
  schemaVersion: "1.0";
  generatedAt: string;
  project: ProjectRef;
  aicfVersion: string;
  capabilityInventory: CapabilityInventoryItem[];
  riskInventory: RiskInventoryItem[];
  providerInventory: ProviderInventoryItem[];
  policyInventory: PolicyInventoryItem[];
  evalSummary: EvalSummary;
  securitySummary: SecuritySummary;
  conformanceSummary: ConformanceSummary;
  approvalSummary: ApprovalSummary;
  incidentSummary?: IncidentSummary;
  retentionSummary: RetentionSummary;
  humanReviewPolicySummary: HumanReviewSummary;
  modelUpgradeHistory?: ModelUpgradeRecord[];
  mappings: RiskMapping[];
  gaps: CoverageGap[];
  /**
   * @minItems 1
   */
  disclaimers: [Disclaimer, ...Disclaimer[]];
  redaction: {
    content: "redacted_refs_and_hashes_only";
    omitted: string[];
  };
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "project_ref".
 */
export interface ProjectRef {
  id: string;
  name: string;
  environment?: string;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "capability_inventory_item".
 */
export interface CapabilityInventoryItem {
  id: string;
  name: string;
  version: string;
  capabilityType: string;
  riskTier: EvidenceRiskTier;
  status: string;
  autonomyTier: string;
  domain?: string;
  lifecycle: {
    select?: boolean;
    read?: boolean;
    prepare?: boolean;
    commit?: boolean;
    verify?: boolean;
  };
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "risk_inventory_item".
 */
export interface RiskInventoryItem {
  capabilityId: string;
  declaredRiskTier: EvidenceRiskTier;
  inferredRiskTier: EvidenceRiskTier;
  passed: boolean;
  requiredControls: string[];
  warnings: string[];
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "provider_inventory_item".
 */
export interface ProviderInventoryItem {
  provider: string;
  label: string;
  status: CoverageStatus;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "policy_inventory_item".
 */
export interface PolicyInventoryItem {
  capabilityId: string;
  approvalRequired: boolean;
  auditRequired: boolean;
  idempotencyRequired: boolean;
  permissions: string[];
  policyRules: string[];
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "eval_summary".
 */
export interface EvalSummary {
  status: CoverageStatus;
  total: number;
  passed?: number;
  failed?: number;
  warnings?: number;
  gaps?: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "security_summary".
 */
export interface SecuritySummary {
  status: CoverageStatus;
  missingRequired: number;
  total: number;
  passed?: number;
  failed?: number;
  warnings?: number;
  gaps?: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "conformance_summary".
 */
export interface ConformanceSummary {
  status: CoverageStatus;
  providers: number;
  total: number;
  passed?: number;
  failed?: number;
  warnings?: number;
  gaps?: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "approval_summary".
 */
export interface ApprovalSummary {
  status: CoverageStatus;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "incident_summary".
 */
export interface IncidentSummary {
  status: CoverageStatus;
  total: number;
  open: number;
  resolved: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "retention_summary".
 */
export interface RetentionSummary {
  status: CoverageStatus;
  rawPromptRetention: "none" | "short_diagnostic" | "custom";
  rawProviderPayloadRetention: "none" | "short_diagnostic" | "custom";
  traceMetadataRetentionDays?: number;
  auditRecordRetentionDays?: number;
  evalDatasetRetentionDays?: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "human_review_summary".
 */
export interface HumanReviewSummary {
  status: CoverageStatus;
  approvalRequiredCapabilities: number;
  humanReviewRequiredCapabilities: number;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "model_upgrade_record".
 */
export interface ModelUpgradeRecord {
  changedAt: string;
  fromModel?: string;
  toModel: string;
  reason: string;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "risk_mapping".
 */
export interface RiskMapping {
  framework: "aicf" | "nist_ai_rmf" | "owasp_llm_top_10" | "custom";
  category: string;
  control: string;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "coverage_gap".
 */
export interface CoverageGap {
  code: string;
  message: string;
  severity: "info" | "warning" | "blocking";
  source: string;
}
/**
 * This interface was referenced by `EvidencePackFixture`'s JSON-Schema
 * via the `definition` "disclaimer".
 */
export interface Disclaimer {
  code: string;
  text: string;
}

/**
 * This interface was referenced by `GovernanceGateConfigFixture`'s JSON-Schema
 * via the `definition` "gate_provider".
 */
export type GateProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ai-sdk"
  | "vercel-ai-sdk"
  | "vercel_ai_sdk"
  | "mcp"
  | "langchain"
  | "semantic-kernel"
  | "semantic-kernel-mcp"
  | "semantic-kernel-openapi";
/**
 * This interface was referenced by `GovernanceGateConfigFixture`'s JSON-Schema
 * via the `definition` "gate_risk_tier".
 */
export type GateRiskTier = "none" | "low" | "medium" | "high" | "critical";

export interface GovernanceGateConfigFixture {
  schema_version: "1.0";
  project?: {
    name?: string;
    environment?: string;
  };
  providers?: {
    enabled?: GateProvider[];
    server_url?: string;
  };
  runtime?: {
    default_autonomy_tier?: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
    max_tool_calls_per_run?: number;
  };
  compatibility?: {
    baseline_root?: string;
  };
  gates?: {
    [k: string]: Gate;
  };
}
/**
 * This interface was referenced by `GovernanceGateConfigFixture`'s JSON-Schema
 * via the `definition` "gate".
 */
export interface Gate {
  fail_on_warnings?: boolean;
  require_security_packs_for?: GateRiskTier[];
  require_evals_for?: GateRiskTier[];
  require_conformance_for_enabled_providers?: boolean;
  block_deprecated_capabilities?: boolean;
  artifact_hygiene?: boolean;
}

export interface GovernanceGateReportFixture {
  schema_version: "1.0";
  generatedAt: string;
  environment: string;
  manifestRoot: string;
  configPath?: string;
  passed: boolean;
  exitCode: 0 | 1 | 2 | 3 | 4 | 5;
  summary: {
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  checks: Check[];
  failures: string[];
  warnings: string[];
}
/**
 * This interface was referenced by `GovernanceGateReportFixture`'s JSON-Schema
 * via the `definition` "check".
 */
export interface Check {
  id: string;
  name: string;
  status: "passed" | "failed" | "warning" | "skipped";
  summary: string;
  failures: string[];
  warnings: string[];
  details?: unknown;
}

/**
 * This interface was referenced by `GovernedMemoryFixture`'s JSON-Schema
 * via the `definition` "data_classification".
 */
export type DataClassification =
  | "public"
  | "internal"
  | "customer_pii"
  | "employee_pii"
  | "payment_metadata"
  | "financial"
  | "health"
  | "legal"
  | "security_sensitive"
  | "credential_material";

export interface GovernedMemoryFixture {
  records: GovernedMemoryRecord[];
  schemaVersion: "1.0";
}
/**
 * This interface was referenced by `GovernedMemoryFixture`'s JSON-Schema
 * via the `definition` "governed_memory_record".
 */
export interface GovernedMemoryRecord {
  accountRef?: RedactedRef;
  allowedUseCases: string[];
  confidence: "low" | "medium" | "high";
  consentBasis?: string;
  contentSummary: string;
  createdAt: string;
  disallowedUseCases: string[];
  expiresAt?: string;
  id: string;
  lastConfirmedAt?: string;
  purpose: string;
  retentionPolicy?: {
    id: string;
  };
  scope: "user" | "account" | "tenant" | "workflow" | "session";
  sensitivity: DataClassification[];
  sessionId?: string;
  sourceRef: SourceRef;
  subjectRef: SubjectRef;
  tenantRef?: RedactedRef;
  workflowId?: string;
}
/**
 * This interface was referenced by `GovernedMemoryFixture`'s JSON-Schema
 * via the `definition` "redacted_ref".
 */
export interface RedactedRef {
  refHash: string;
}
/**
 * This interface was referenced by `GovernedMemoryFixture`'s JSON-Schema
 * via the `definition` "source_ref".
 */
export interface SourceRef {
  contentHash?: string;
  freshness?: "fresh" | "stale" | "unknown";
  retrievedAt?: string;
  sourceId: string;
  sourceType:
    | "user_message"
    | "uploaded_file"
    | "retrieved_document"
    | "app_record"
    | "tool_result"
    | "external_api"
    | "policy"
    | "manual_review"
    | "model_output";
  trust:
    | "system_instruction"
    | "developer_instruction"
    | "app_policy"
    | "app_data"
    | "tool_result"
    | "retrieved_document"
    | "user_input"
    | "model_output"
    | "external_api";
  uri?: string;
}
/**
 * This interface was referenced by `GovernedMemoryFixture`'s JSON-Schema
 * via the `definition` "subject_ref".
 */
export interface SubjectRef {
  actorType?: string;
  refHash: string;
}

export interface GeneratedContentProvenanceFixture {
  schemaVersion: "1.0";
  contentId: string;
  contentType: "text" | "document" | "image" | "audio" | "video" | "other";
  generatedBy: "model" | "model_assisted_human" | "human_approved_model";
  /**
   * @minItems 1
   */
  providerRefs: [ProviderRef, ...ProviderRef[]];
  /**
   * @minItems 1
   */
  modelRefs: [string, ...string[]];
  /**
   * @minItems 1
   */
  capabilityRefs: [CapabilityRef, ...CapabilityRef[]];
  /**
   * @minItems 1
   */
  sourceRefs: [SourceRef, ...SourceRef[]];
  approvalRefs?: string[];
  traceRef?: TraceRef;
  createdAt: string;
}
/**
 * This interface was referenced by `GeneratedContentProvenanceFixture`'s JSON-Schema
 * via the `definition` "provider_ref".
 */
export interface ProviderRef {
  providerId: string;
  requestId?: string;
  responseId?: string;
  runId?: string;
  traceId?: string;
}
/**
 * This interface was referenced by `GeneratedContentProvenanceFixture`'s JSON-Schema
 * via the `definition` "capability_ref".
 */
export interface CapabilityRef {
  capabilityId: string;
  operation?: "select" | "read" | "prepare" | "commit" | "verify";
  version?: string;
}
/**
 * This interface was referenced by `GeneratedContentProvenanceFixture`'s JSON-Schema
 * via the `definition` "source_ref".
 */
export interface SourceRef {
  contentHash?: string;
  freshness?: "fresh" | "stale" | "unknown";
  retrievedAt?: string;
  sourceId: string;
  sourceType:
    | "user_message"
    | "uploaded_file"
    | "retrieved_document"
    | "app_record"
    | "tool_result"
    | "external_api"
    | "policy"
    | "manual_review"
    | "model_output";
  trust:
    | "system_instruction"
    | "developer_instruction"
    | "app_policy"
    | "app_data"
    | "tool_result"
    | "retrieved_document"
    | "user_input"
    | "model_output"
    | "external_api";
  uri?: string;
}
/**
 * This interface was referenced by `GeneratedContentProvenanceFixture`'s JSON-Schema
 * via the `definition` "trace_ref".
 */
export interface TraceRef {
  provider?: string;
  traceId: string;
}

/**
 * This interface was referenced by `ProvenanceAdapterHookResultFixture`'s JSON-Schema
 * via the `definition` "provenance_json".
 */
export type ProvenanceJson = null | boolean | number | string | ProvenanceJson[] | ProvenanceJsonObject;

export interface ProvenanceAdapterHookResultFixture {
  schemaVersion: "1.0";
  adapterId: string;
  status: "attached" | "skipped" | "failed";
  labels?: {
    [k: string]: string;
  };
  sidecar?: ProvenanceJsonObject;
  diagnostics?: Diagnostic[];
}
/**
 * This interface was referenced by `ProvenanceAdapterHookResultFixture`'s JSON-Schema
 * via the `definition` "provenance_json_object".
 */
export interface ProvenanceJsonObject {
  [k: string]: ProvenanceJson;
}
/**
 * This interface was referenced by `ProvenanceAdapterHookResultFixture`'s JSON-Schema
 * via the `definition` "diagnostic".
 */
export interface Diagnostic {
  code: string;
  message: string;
  path?: string;
  severity: "info" | "warning" | "error";
}

export interface ReplayResultFixture {
  schemaVersion: "1.0";
  traceId: string;
  mode: "deterministic_mock" | "provider_live" | "policy_only" | "router_only" | "tool_validation_only";
  status: "passed" | "failed" | "refused";
  steps: {
    name: string;
    status: "passed" | "failed" | "skipped";
    message: string;
    expected?: unknown;
    actual?: unknown;
  }[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
  diagnostics: {}[];
  extensions?: {};
}

/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "json".
 */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [k: string]: Json;
    };

export interface ReplayTraceFixture {
  schemaVersion: "1.0";
  traceId: string;
  runId: string;
  createdAt: string;
  runtimeVersion?: string;
  provider?: {
    id: string;
    model?: string;
    promptTemplateVersion?: string;
  };
  capabilitySlice: CapabilitySlice;
  capabilityVersions: {
    [k: string]: string;
  };
  context: RedactedContext;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  policyDecisions: PolicyDecision[];
  actions: Action[];
  approvals?: Approval[];
  finalResponse?: FinalResponse;
  redaction: RedactionSummary;
  extensions?: {};
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "capabilitySlice".
 */
export interface CapabilitySlice {
  capabilityIds: string[];
  excludedCapabilityIds?: string[];
  hash?: string;
  includeRestricted?: boolean;
  maxCapabilities?: number;
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "redactedContext".
 */
export interface RedactedContext {
  contextHash: string;
  userInputSummary?: string;
  decisionContext: {
    permissions: string[];
    autonomyTier: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
    allowedRiskTiers?: ("none" | "low" | "medium" | "high" | "critical")[];
    riskCeiling?: "none" | "low" | "medium" | "high" | "critical";
    tenantId?: string;
    userId?: string;
  };
  facts?: {
    [k: string]:
      | boolean
      | {
          value: boolean;
          reason?: string;
        };
  };
  sourceRefs?: {
    sourceId: string;
    sourceType: string;
    trust: string;
    contentHash?: string;
  }[];
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "toolCall".
 */
export interface ToolCall {
  callId?: string;
  provider?: string;
  providerToolName?: string;
  capabilityId: string;
  operation: "read" | "prepare" | "commit";
  args: {
    [k: string]: Json;
  };
  argsHash: string;
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "toolResult".
 */
export interface ToolResult {
  callId?: string;
  capabilityId: string;
  status: "ok" | "unavailable" | "denied" | "approval_required" | "error" | "verified";
  actionState?: string;
  policyDecision?: "allowed" | "approval_required" | "denied";
  resultHash: string;
  modelSafeEnvelope?: Json;
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "policyDecision".
 */
export interface PolicyDecision {
  decisionId?: string;
  capabilityId: string;
  operation: "select" | "read" | "prepare" | "approve" | "commit";
  decision: "allowed" | "approval_required" | "denied";
  reasons?: {
    code: string;
    message: string;
    ruleId?: string;
    severity?: string;
    source?: string;
  }[];
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "action".
 */
export interface Action {
  actionId: string;
  capabilityId: string;
  preparedActionId?: string;
  actionState:
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
  resultHash?: string;
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "approval".
 */
export interface Approval {
  approvalRecordId: string;
  preparedActionId: string;
  capabilityId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  requiredReasonCodes?: string[];
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "finalResponse".
 */
export interface FinalResponse {
  text?: string;
  textHash: string;
  redacted?: boolean;
  placeholders?: string[];
}
/**
 * This interface was referenced by `ReplayTraceFixture`'s JSON-Schema
 * via the `definition` "redactionSummary".
 */
export interface RedactionSummary {
  fieldsRedacted: string[];
  hashAlgorithm: "sha256";
  mode: "redacted" | "unsafe_unredacted";
}

export interface TraceToGoldenOptionsFixture {
  suiteId: string;
  evalId?: string;
  capabilityUnderTest?: string;
  includeRawContent?: boolean;
  requireReview?: boolean;
  tags?: string[];
}

export interface SecurityPackCoverageReportFixture {
  schema_version: "1.0";
  generatedAt: string;
  passed: boolean;
  missingRequired: number;
  capabilities: {
    capabilityId: string;
    riskTier: "none" | "low" | "medium" | "high" | "critical";
    assignedPacks: string[];
    recommendedPacks: string[];
    requiredPacks: string[];
    missingRequiredPacks: string[];
    validWaivers: {}[];
    warnings: string[];
  }[];
}

export interface PromptfooRedTeamConfigFixture {
  description: string;
  /**
   * @minItems 1
   */
  prompts: [string, ...string[]];
  /**
   * @minItems 1
   */
  providers: [string, ...string[]];
  tests: {
    description: string;
    vars: {};
    assert: {}[];
  }[];
}

export interface SecurityCaseSuiteFixture {
  schema_version: "1.0";
  generatedAt: string;
  cases: {
    id: string;
    packId: string;
    capabilityId: string;
    capabilityType: string;
    riskTier: "none" | "low" | "medium" | "high" | "critical";
    name: string;
    userMessage: string;
    expected: {};
    tags: string[];
  }[];
}

/**
 * This interface was referenced by `SecurityPackFixture`'s JSON-Schema
 * via the `definition` "pack_id".
 */
export type PackId =
  | "prompt_injection_direct"
  | "prompt_injection_indirect"
  | "tool_exfiltration"
  | "cross_tenant_access"
  | "approval_bypass"
  | "unsafe_commit_attempt"
  | "schema_confusion"
  | "capability_spoofing"
  | "tool_result_poisoning"
  | "sensitive_data_disclosure"
  | "insecure_output_rendering"
  | "cost_amplification"
  | "provider_payload_exposure"
  | "mcp_tool_abuse"
  | "retrieval_poisoning"
  | "memory_scope_violation";
/**
 * This interface was referenced by `SecurityPackFixture`'s JSON-Schema
 * via the `definition` "capability_type".
 */
export type CapabilityType =
  | "read_data"
  | "retrieve_documents"
  | "compute"
  | "write_prepare_only"
  | "write_commit"
  | "external_message_prepare"
  | "external_message_send"
  | "workflow_start"
  | "workflow_step"
  | "human_handoff";
/**
 * This interface was referenced by `SecurityPackFixture`'s JSON-Schema
 * via the `definition` "risk_tier".
 */
export type RiskTier = "none" | "low" | "medium" | "high" | "critical";

export interface SecurityPackFixture {
  schema_version: "1.0";
  id: PackId;
  name: string;
  description: string;
  /**
   * @minItems 1
   */
  mappedRisks: [
    {
      framework: "aicf" | "nist_ai_rmf" | "owasp_llm_top_10";
      category: string;
      description: string;
    },
    ...{
      framework: "aicf" | "nist_ai_rmf" | "owasp_llm_top_10";
      category: string;
      description: string;
    }[]
  ];
  /**
   * @minItems 1
   */
  applicableCapabilityTypes: [CapabilityType, ...CapabilityType[]];
  /**
   * @minItems 1
   */
  minimumRiskTiers: [RiskTier, ...RiskTier[]];
  /**
   * @minItems 1
   */
  cases: [
    {
      id: string;
      name: string;
      userMessageTemplate: string;
      tags: string[];
      expected: {};
    },
    ...{
      id: string;
      name: string;
      userMessageTemplate: string;
      tags: string[];
      expected: {};
    }[]
  ];
  /**
   * @minItems 1
   */
  expectedControls: [
    {
      code: string;
      description: string;
      required: boolean;
    },
    ...{
      code: string;
      description: string;
      required: boolean;
    }[]
  ];
}

export interface ToolResultEnvelopeFixture {
  schema_version: "1.0";
  capability_id: string;
  capability_version: string;
  status: "ok" | "unavailable" | "denied" | "approval_required" | "error";
  data?: unknown;
  evidence?: EvidenceRef[];
  policy?: PolicyDecisionSummary;
  action?: PreparedActionSummary;
  user_message?: string;
  private_diagnostics?: unknown;
}
/**
 * This interface was referenced by `ToolResultEnvelopeFixture`'s JSON-Schema
 * via the `definition` "evidence_ref".
 */
export interface EvidenceRef {
  source_id: string;
  source_type?: string;
  span_id?: string;
  quote?: string;
  confidence?: "low" | "medium" | "high";
}
/**
 * This interface was referenced by `ToolResultEnvelopeFixture`'s JSON-Schema
 * via the `definition` "policy_decision_summary".
 */
export interface PolicyDecisionSummary {
  status: "allowed" | "approval_required" | "denied";
  reasons?: {
    code: string;
    message: string;
    rule?: string;
  }[];
}
/**
 * This interface was referenced by `ToolResultEnvelopeFixture`'s JSON-Schema
 * via the `definition` "prepared_action_summary".
 */
export interface PreparedActionSummary {
  prepared_action_id?: string;
  action_state: "none" | "prepared" | "approval_required" | "committed" | "verified" | "denied" | "refused";
  preview?: unknown;
  approval_required?: boolean;
}
