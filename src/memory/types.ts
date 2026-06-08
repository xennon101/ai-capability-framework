import type {
  RedactedAccountRef,
  RedactedSubjectRef,
  RedactedTenantRef
} from "../audit/index.js";
import type {
  ContextSegment,
  DataClassification,
  RetentionPolicyRef,
  SourceRef
} from "../security/index.js";
import type { AicfContextItem } from "../runtime/index.js";

export type MemoryScope = "user" | "account" | "tenant" | "workflow" | "session";
export type MemoryConfidence = "low" | "medium" | "high";

export interface GovernedMemoryRecord {
  accountRef?: RedactedAccountRef;
  allowedUseCases: string[];
  confidence: MemoryConfidence;
  consentBasis?: string;
  contentSummary: string;
  createdAt: string;
  disallowedUseCases: string[];
  expiresAt?: string;
  id: string;
  lastConfirmedAt?: string;
  purpose: string;
  retentionPolicy?: RetentionPolicyRef;
  scope: MemoryScope;
  sensitivity: DataClassification[];
  sessionId?: string;
  sourceRef: SourceRef;
  subjectRef: RedactedSubjectRef;
  tenantRef?: RedactedTenantRef;
  workflowId?: string;
}

export interface GovernedMemoryFixture {
  records: GovernedMemoryRecord[];
  schemaVersion: "1.0";
}

export interface MemoryExposureContext {
  accountRef?: RedactedAccountRef;
  capabilityId?: string;
  maxRecords?: number;
  now?: string;
  operation?: string;
  providerId?: string;
  requireConsentForSensitive?: boolean;
  scope?: MemoryScope;
  sessionId?: string;
  subjectRef?: RedactedSubjectRef;
  tenantRef?: RedactedTenantRef;
  useCase: string;
  workflowId?: string;
}

export interface MemoryReason {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface MemoryRecordValidationResult {
  errors: MemoryReason[];
  valid: boolean;
  warnings: MemoryReason[];
}

export interface MemoryExposureDecision {
  allowed: boolean;
  recordId: string;
  reasons: MemoryReason[];
  warnings: MemoryReason[];
}

export interface MemorySelectionResult {
  decisions: MemoryExposureDecision[];
  selectedContextItems: AicfContextItem[];
  selectedRecords: GovernedMemoryRecord[];
  selectedSegments: ContextSegment[];
}

export interface MemoryContextConversionOptions {
  idPrefix?: string;
  labelPrefix?: string;
  visibleToModel?: boolean;
}
