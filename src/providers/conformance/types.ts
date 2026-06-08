import type { AicfDiagnostic, DecisionRequest, JsonObject, ManifestRegistry } from "../../types.js";

export type ProviderConformanceTarget =
  | "ai-sdk"
  | "anthropic"
  | "gemini"
  | "langchain"
  | "mcp"
  | "openai"
  | "semantic-kernel"
  | "semantic-kernel-mcp"
  | "semantic-kernel-openapi";

export type CanonicalProviderConformanceTarget = Exclude<ProviderConformanceTarget, "semantic-kernel">;

export type ProviderConformanceTargetAlias =
  | "semantic-kernel"
  | "vercel-ai-sdk"
  | "vercel_ai_sdk";

export type ProviderConformanceDimension =
  | "approval_required_behavior"
  | "commit_tool_not_exposed_by_default"
  | "descriptor_export"
  | "disabled_capability_filtering"
  | "provider_error_normalization"
  | "risk_filtering"
  | "schema_downgrade_reporting"
  | "schema_normalization"
  | "streaming_or_loop_semantics"
  | "tool_arg_validation"
  | "tool_call_parsing"
  | "tool_name_mapping"
  | "tool_result_envelope";

export interface ProviderTargetMetadata {
  adapterKind: "descriptor" | "openapi";
  canonicalProvider: CanonicalProviderConformanceTarget;
  label: string;
  provider: ProviderConformanceTarget;
  requiresContext: boolean;
  requiresServerUrl: boolean;
  runtimeBoundary: "descriptor_only" | "bounded_loop" | "host_framework_bridge" | "openapi_metadata";
}

export interface ProviderToolExportRequest {
  capabilityIds?: string[];
  context: DecisionRequest["context"];
  includeDiagnostics?: boolean;
  includeRestricted?: boolean;
  provider: ProviderConformanceTarget;
  registry: ManifestRegistry;
  serverUrl?: string;
}

export interface ProviderToolExportResult {
  artifact: unknown;
  bindings: ProviderToolExportBinding[];
  diagnostics: AicfDiagnostic[];
  exportedCount: number;
  provider: ProviderConformanceTarget;
  providerToolNames: string[];
}

export interface ProviderToolExportBinding {
  capabilityId: string;
  operation: "read" | "prepare" | "commit";
  providerToolName: string;
  restricted: boolean;
}

export interface ProviderConformanceCase {
  capabilityIds: string[];
  expected: {
    canonicalToolCalls?: Array<{
      argsSubset?: Record<string, unknown>;
      capabilityId: string;
    }>;
    finalTextRequiredSubstrings?: string[];
    providerToolNames?: string[];
    resultStatuses?: string[];
  };
  id: string;
  input: string;
  mockProviderResponses?: unknown[];
  provider?: ProviderConformanceTarget;
}

export type ProviderConformanceScorer =
  | "approval_required_behavior"
  | "canonical_args_valid"
  | "canonical_tool_call_matches"
  | "capability_slice_enforced"
  | "commit_tool_not_exposed_by_default"
  | "descriptor_export"
  | "disabled_capability_filtering"
  | "no_commit_tool_exported"
  | "no_raw_payload_logged"
  | "provider_error_normalization"
  | "provider_result_correlation_preserved"
  | "provider_safe_error_envelope"
  | "provider_tool_maps_to_capability"
  | "provider_tool_name_valid"
  | "risk_filtering"
  | "schema_downgrade_reporting"
  | "schema_normalization"
  | "streaming_or_loop_semantics"
  | "tool_call_parsing"
  | "tool_result_envelope";

export interface ProviderConformanceScorerResult {
  diagnostics: string[];
  dimension: ProviderConformanceDimension;
  passed: boolean;
  scorer: ProviderConformanceScorer;
}

export interface ProviderConformanceResult {
  caseId: string;
  capabilityIds: string[];
  diagnostics: string[];
  dimensions: ProviderConformanceScorerResult[];
  exportResult?: ProviderToolExportResult;
  passed: boolean;
  provider: ProviderConformanceTarget;
  scorers: ProviderConformanceScorerResult[];
}

export interface ProviderConformanceReport {
  aicfVersion: string;
  capabilityResults: CapabilityConformanceResult[];
  counts: {
    failed: number;
    passed: number;
    providers: number;
    results: number;
  };
  failures: ConformanceFailure[];
  generatedAt: string;
  passed: boolean;
  providerResults: ProviderConformanceProviderResult[];
  results: ProviderConformanceResult[];
  schemaVersion: "1.0";
  summary: {
    fail: number;
    pass: number;
    providers: number;
    results: number;
    warn: number;
  };
  warnings: ConformanceWarning[];
}

export interface ProviderConformanceProviderResult {
  dimensions: Array<{
    dimension: ProviderConformanceDimension;
    failed: number;
    passed: number;
  }>;
  failed: number;
  label: string;
  passed: boolean;
  provider: CanonicalProviderConformanceTarget;
  results: number;
}

export interface CapabilityConformanceResult {
  capabilityId: string;
  caseIds: string[];
  diagnostics: string[];
  dimensions: ProviderConformanceScorerResult[];
  passed: boolean;
  provider: CanonicalProviderConformanceTarget;
}

export interface ConformanceFailure {
  capabilityId?: string;
  caseId: string;
  dimension: ProviderConformanceDimension;
  message: string;
  provider: CanonicalProviderConformanceTarget;
}

export interface ConformanceWarning {
  caseId?: string;
  dimension?: ProviderConformanceDimension;
  message: string;
  provider?: CanonicalProviderConformanceTarget;
}

export interface RunProviderConformanceSuiteOptions {
  aicfVersion?: string;
  cases?: ProviderConformanceCase[];
  context?: DecisionRequest["context"];
  generatedAt?: string;
  providers?: Array<ProviderConformanceTarget | ProviderConformanceTargetAlias>;
  registry: ManifestRegistry;
  serverUrl?: string;
}

export interface ProviderTargetMatrix {
  generatedAt: string;
  schemaVersion: "1.0";
  targets: ProviderTargetMetadata[];
}

export type ProviderConformanceReportFormat = "json" | "text";

export type ProviderConformanceMatrixFormat = "json" | "markdown";

export type ProviderConformanceJsonObject = JsonObject;
