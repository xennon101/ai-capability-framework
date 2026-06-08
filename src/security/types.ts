import type { JsonValue } from "../types.js";
import type { AicfContextItem } from "../runtime/index.js";

export type TrustLabel =
  | "system_instruction"
  | "developer_instruction"
  | "app_policy"
  | "app_data"
  | "tool_result"
  | "retrieved_document"
  | "user_input"
  | "model_output"
  | "external_api";

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

export type SourceType =
  | "user_message"
  | "uploaded_file"
  | "retrieved_document"
  | "app_record"
  | "tool_result"
  | "external_api"
  | "policy"
  | "manual_review"
  | "model_output";

export interface SourceRef {
  contentHash?: string;
  freshness?: "fresh" | "stale" | "unknown";
  retrievedAt?: string;
  sourceId: string;
  sourceType: SourceType;
  trust: TrustLabel;
  uri?: string;
}

export interface RetentionPolicyRef {
  id: string;
}

export interface TaintMark {
  createdAt?: string;
  reason: string;
  sourceRef?: SourceRef;
  trust: TrustLabel;
}

export interface ContextSegment<T = unknown> {
  content: T;
  dataClassifications: DataClassification[];
  id: string;
  instructionsAllowed: boolean;
  label: string;
  retentionPolicy?: RetentionPolicyRef;
  sourceRef?: SourceRef;
  taint?: TaintMark[];
  trust: TrustLabel;
}

export interface AicfSecurityReason {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface ContextSegmentValidationResult {
  errors: AicfSecurityReason[];
  valid: boolean;
  warnings: AicfSecurityReason[];
}

export type RedactionBoundary = "provider" | "trace";
export type RedactionMode = "allow" | "redact" | "deny";
export type RedactionDiagnosticMode = "safe" | "unsafe_raw_content";

export interface RedactionRule {
  boundary?: RedactionBoundary;
  capabilityIds?: string[];
  dataClassifications?: DataClassification[];
  id: string;
  mode: RedactionMode;
  operations?: string[];
  paths?: string[];
  providerIds?: string[];
  trustLabels?: TrustLabel[];
}

export interface RedactionPolicy {
  defaultMode: RedactionMode;
  id: string;
  rules: RedactionRule[];
}

export interface RedactionContext {
  boundary: RedactionBoundary;
  capabilityId?: string;
  diagnosticMode?: RedactionDiagnosticMode;
  operation?: string;
  path?: string;
  providerId?: string;
  segment?: ContextSegment;
}

export interface RedactionEvent {
  classification?: DataClassification;
  mode: RedactionMode;
  path: string;
  reason: string;
  ruleId?: string;
}

export interface RedactionResult<T = unknown> {
  reasons: AicfSecurityReason[];
  redactions: RedactionEvent[];
  status: "allowed" | "redacted" | "denied";
  value?: T;
}

export interface RetentionPolicy {
  allowRawContentInEvals: boolean;
  auditRecordRetentionDays?: number;
  evalDatasetRetentionDays?: number;
  id: string;
  rawPromptRetention: "none" | "short_diagnostic" | "custom";
  rawProviderPayloadRetention: "none" | "short_diagnostic" | "custom";
  traceMetadataRetentionDays?: number;
}

export interface RetentionEvaluationContext {
  diagnosticMode?: RedactionDiagnosticMode;
  useCase?: "trace" | "audit" | "eval" | "provider_payload" | "prompt";
}

export interface RetentionEvaluationResult {
  allowed: boolean;
  policy: RetentionPolicy;
  reasons: AicfSecurityReason[];
  warnings: AicfSecurityReason[];
}

export interface RuntimeContextSegmentInput {
  item: AicfContextItem;
  sourceRef?: SourceRef;
}

export type JsonRecord = Record<string, JsonValue>;
