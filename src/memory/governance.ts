import {
  createContextSegment,
  markTainted,
  type ContextSegment,
  type DataClassification,
  type SourceRef,
  type TrustLabel
} from "../security/index.js";
import type { AicfContextItem } from "../runtime/index.js";
import type {
  GovernedMemoryRecord,
  MemoryContextConversionOptions,
  MemoryExposureContext,
  MemoryExposureDecision,
  MemoryReason,
  MemoryRecordValidationResult,
  MemorySelectionResult,
  MemoryScope
} from "./types.js";

const defaultMaxRecords = 20;
const knownScopes = new Set<MemoryScope>(["user", "account", "tenant", "workflow", "session"]);
const knownConfidence = new Set(["low", "medium", "high"]);
const knownClassifications = new Set<DataClassification>([
  "public",
  "internal",
  "customer_pii",
  "employee_pii",
  "payment_metadata",
  "financial",
  "health",
  "legal",
  "security_sensitive",
  "credential_material"
]);
const sensitiveClassifications = new Set<DataClassification>([
  "customer_pii",
  "employee_pii",
  "payment_metadata",
  "financial",
  "health",
  "legal",
  "security_sensitive"
]);
const taintedTrusts = new Set<TrustLabel>([
  "user_input",
  "retrieved_document",
  "tool_result",
  "external_api",
  "model_output"
]);

export function validateGovernedMemoryRecord(record: GovernedMemoryRecord): MemoryRecordValidationResult {
  const errors: MemoryReason[] = [];
  const warnings: MemoryReason[] = [];

  if (!hasText(record.id)) errors.push(reason("memory_id_required", "Memory record id is required."));
  if (!hasText(record.purpose)) errors.push(reason("memory_purpose_required", "Memory record purpose is required."));
  if (!hasText(record.contentSummary)) errors.push(reason("memory_summary_required", "Memory record contentSummary is required."));
  if (!knownScopes.has(record.scope)) errors.push(reason("memory_scope_invalid", "Memory record scope is invalid."));
  if (!knownConfidence.has(record.confidence)) errors.push(reason("memory_confidence_invalid", "Memory confidence is invalid."));
  if (!record.subjectRef?.refHash) errors.push(reason("memory_subject_ref_required", "Memory record subjectRef.refHash is required."));
  if (!validSourceRef(record.sourceRef)) errors.push(reason("memory_source_ref_required", "Memory record sourceRef is incomplete."));

  for (const field of ["createdAt", "lastConfirmedAt", "expiresAt"] as const) {
    const value = record[field];
    if (value !== undefined && !isIsoLike(value)) {
      errors.push(reason("memory_timestamp_invalid", `Memory record ${field} must be a valid timestamp.`));
    }
  }

  if (!Array.isArray(record.allowedUseCases)) {
    errors.push(reason("memory_allowed_use_cases_invalid", "Memory record allowedUseCases must be an array."));
  }
  if (!Array.isArray(record.disallowedUseCases)) {
    errors.push(reason("memory_disallowed_use_cases_invalid", "Memory record disallowedUseCases must be an array."));
  }

  for (const classification of record.sensitivity ?? []) {
    if (!knownClassifications.has(classification)) {
      errors.push(reason("memory_classification_invalid", `Unknown memory data classification "${classification}".`));
    }
  }
  if ((record.sensitivity ?? []).length === 0) {
    warnings.push(reason("memory_classification_missing", "Memory record should declare at least one data classification.", "warning"));
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings
  };
}

export function evaluateMemoryExposure(
  record: GovernedMemoryRecord,
  context: MemoryExposureContext
): MemoryExposureDecision {
  const validation = validateGovernedMemoryRecord(record);
  const reasons = [...validation.errors];
  const warnings = [...validation.warnings];
  const now = parseTime(context.now ?? new Date().toISOString());

  if (!hasText(context.useCase)) {
    reasons.push(reason("memory_use_case_required", "Memory exposure context requires a useCase."));
  }
  if (record.expiresAt && parseTime(record.expiresAt) <= now) {
    reasons.push(reason("memory_expired", "Memory record is expired."));
  }
  if (record.disallowedUseCases.includes(context.useCase)) {
    reasons.push(reason("memory_use_case_disallowed", "Memory record disallows this use case."));
  }
  if (!record.allowedUseCases.includes(context.useCase)) {
    reasons.push(reason("memory_use_case_not_allowed", "Memory record does not explicitly allow this use case."));
  }
  if (record.sensitivity.includes("credential_material")) {
    reasons.push(reason("memory_credential_material_denied", "Credential-classified memory must not be exposed."));
  }
  if ((context.requireConsentForSensitive ?? true) && hasSensitiveClassification(record) && !hasText(record.consentBasis)) {
    reasons.push(reason("memory_sensitive_consent_required", "Sensitive memory requires a consent basis before exposure."));
  }
  reasons.push(...scopeReasons(record, context));

  return {
    allowed: reasons.length === 0,
    recordId: record.id,
    reasons,
    warnings
  };
}

export function selectGovernedMemory(
  records: GovernedMemoryRecord[],
  context: MemoryExposureContext
): MemorySelectionResult {
  const decisions = records.map((record) => evaluateMemoryExposure(record, context));
  const allowedById = new Set(decisions.filter((decision) => decision.allowed).map((decision) => decision.recordId));
  const selectedRecords = records
    .filter((record) => allowedById.has(record.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, context.maxRecords ?? defaultMaxRecords);

  return {
    decisions,
    selectedContextItems: selectedRecords.map((record) => memoryRecordToRuntimeContextItem(record)),
    selectedRecords,
    selectedSegments: selectedRecords.map((record) => memoryRecordToContextSegment(record))
  };
}

export function memoryRecordToContextSegment(
  record: GovernedMemoryRecord,
  options: MemoryContextConversionOptions = {}
): ContextSegment {
  const segment = createContextSegment({
    content: {
      confidence: record.confidence,
      contentSummary: record.contentSummary,
      purpose: record.purpose,
      scope: record.scope
    },
    dataClassifications: record.sensitivity.length > 0 ? [...record.sensitivity].sort() : ["internal"],
    id: `${options.idPrefix ?? "memory"}:${record.id}`,
    instructionsAllowed: false,
    label: `${options.labelPrefix ?? "Memory"}: ${record.purpose}`,
    retentionPolicy: record.retentionPolicy ?? { id: "aicf.memory.default" },
    sourceRef: safeSourceRef(record.sourceRef),
    trust: "app_data"
  });

  if (taintedTrusts.has(record.sourceRef.trust)) {
    return markTainted(segment, {
      reason: "Memory source is data only and cannot become instructions.",
      sourceRef: safeSourceRef(record.sourceRef),
      trust: record.sourceRef.trust
    });
  }

  return segment;
}

export function memoryRecordToRuntimeContextItem(
  record: GovernedMemoryRecord,
  options: MemoryContextConversionOptions = {}
): AicfContextItem {
  return {
    data: {
      allowedUseCases: [...record.allowedUseCases].sort(),
      confidence: record.confidence,
      purpose: record.purpose,
      scope: record.scope
    },
    dataClasses: record.sensitivity.length > 0 ? [...record.sensitivity].sort() : ["internal"],
    id: `${options.idPrefix ?? "memory"}_${safeId(record.id)}`,
    kind: "fact",
    source: {
      freshness: freshnessFor(record),
      id: record.sourceRef.sourceId,
      type: sourceTypeFor(record.sourceRef)
    },
    text: record.contentSummary,
    title: `${options.labelPrefix ?? "Memory"}: ${record.purpose}`,
    trusted: true,
    visibleToModel: options.visibleToModel ?? true
  };
}

function scopeReasons(record: GovernedMemoryRecord, context: MemoryExposureContext): MemoryReason[] {
  if (context.scope && record.scope !== context.scope) {
    return [reason("memory_scope_mismatch", "Memory record scope does not match the requested scope.")];
  }

  switch (record.scope) {
    case "user":
      return refMatches(record.subjectRef, context.subjectRef)
        ? []
        : [reason("memory_subject_scope_mismatch", "User-scoped memory does not match the runtime subject.")];
    case "account":
      return refMatches(record.accountRef, context.accountRef)
        ? []
        : [reason("memory_account_scope_mismatch", "Account-scoped memory does not match the runtime account.")];
    case "tenant":
      return refMatches(record.tenantRef, context.tenantRef)
        ? []
        : [reason("memory_tenant_scope_mismatch", "Tenant-scoped memory does not match the runtime tenant.")];
    case "workflow":
      return hasText(record.workflowId) && record.workflowId === context.workflowId
        ? []
        : [reason("memory_workflow_scope_mismatch", "Workflow-scoped memory does not match the runtime workflow.")];
    case "session":
      return hasText(record.sessionId) && record.sessionId === context.sessionId
        ? []
        : [reason("memory_session_scope_mismatch", "Session-scoped memory does not match the runtime session.")];
  }
}

function hasSensitiveClassification(record: GovernedMemoryRecord): boolean {
  return record.sensitivity.some((classification) => sensitiveClassifications.has(classification));
}

function validSourceRef(sourceRef: SourceRef | undefined): sourceRef is SourceRef {
  return Boolean(sourceRef?.sourceId && sourceRef.sourceType && sourceRef.trust);
}

function safeSourceRef(sourceRef: SourceRef): SourceRef {
  return {
    contentHash: sourceRef.contentHash,
    freshness: sourceRef.freshness,
    retrievedAt: sourceRef.retrievedAt,
    sourceId: sourceRef.sourceId,
    sourceType: sourceRef.sourceType,
    trust: sourceRef.trust
  };
}

function sourceTypeFor(sourceRef: SourceRef): NonNullable<AicfContextItem["source"]>["type"] {
  switch (sourceRef.sourceType) {
    case "retrieved_document":
    case "uploaded_file":
      return "document";
    case "external_api":
      return "api";
    case "user_message":
      return "user";
    case "policy":
      return "system";
    default:
      return "app";
  }
}

function freshnessFor(record: GovernedMemoryRecord): NonNullable<AicfContextItem["source"]>["freshness"] {
  if (record.expiresAt && parseTime(record.expiresAt) <= Date.now()) return "stale";
  return record.sourceRef.freshness === "stale" ? "stale" : record.sourceRef.freshness === "unknown" ? "unknown" : "recent";
}

function refMatches(left: { refHash?: string } | undefined, right: { refHash?: string } | undefined): boolean {
  return Boolean(left?.refHash && right?.refHash && left.refHash === right.refHash);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoLike(value: string): boolean {
  return Number.isFinite(parseTime(value));
}

function parseTime(value: string): number {
  return Date.parse(value);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "record";
}

function reason(code: string, message: string, severity: MemoryReason["severity"] = "error"): MemoryReason {
  return { code, message, severity };
}
