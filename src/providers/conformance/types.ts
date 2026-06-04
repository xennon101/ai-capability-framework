import type { AicfDiagnostic, DecisionRequest, JsonObject, ManifestRegistry } from "../../types.js";

export type ProviderConformanceTarget =
  | "ai-sdk"
  | "anthropic"
  | "gemini"
  | "langchain"
  | "mcp"
  | "openai"
  | "semantic-kernel";

export interface ProviderTargetMetadata {
  adapterKind: "descriptor" | "openapi";
  label: string;
  provider: ProviderConformanceTarget;
  requiresContext: boolean;
  requiresServerUrl: boolean;
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
  | "canonical_args_valid"
  | "canonical_tool_call_matches"
  | "capability_slice_enforced"
  | "no_commit_tool_exported"
  | "no_raw_payload_logged"
  | "provider_result_correlation_preserved"
  | "provider_safe_error_envelope"
  | "provider_tool_maps_to_capability"
  | "provider_tool_name_valid";

export interface ProviderConformanceScorerResult {
  diagnostics: string[];
  passed: boolean;
  scorer: ProviderConformanceScorer;
}

export interface ProviderConformanceResult {
  caseId: string;
  diagnostics: string[];
  exportResult?: ProviderToolExportResult;
  passed: boolean;
  provider: ProviderConformanceTarget;
  scorers: ProviderConformanceScorerResult[];
}

export interface ProviderConformanceReport {
  counts: {
    failed: number;
    passed: number;
    providers: number;
    results: number;
  };
  passed: boolean;
  results: ProviderConformanceResult[];
}

export interface RunProviderConformanceSuiteOptions {
  cases?: ProviderConformanceCase[];
  context?: DecisionRequest["context"];
  providers?: ProviderConformanceTarget[];
  registry: ManifestRegistry;
  serverUrl?: string;
}

export type ProviderConformanceReportFormat = "json" | "text";

export type ProviderConformanceJsonObject = JsonObject;
