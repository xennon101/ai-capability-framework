import { DefaultRedactionPolicy } from "../runtime/index.js";
import {
  createContextSegment,
  defaultSecurityRedactionPolicy,
  redactForTrace
} from "../security/index.js";
import type { JsonValue } from "../types.js";
import type {
  DataClassification,
  TrustLabel
} from "../security/index.js";
import type {
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceRedactionOptions
} from "./types.js";

const sensitiveKeyPattern = /password|token|secret|api_?key|authorization|cookie|session|card|cvv|private_?key|provider_?payload|raw_?prompt|raw_?trace/i;
const contentKeyPattern = /prompt|input|output|message|content|text|payload|trace/i;

export function sanitizeTraceEvent(
  event: AicfRuntimeTraceEvent,
  options: AicfTraceRedactionOptions = {}
): AicfRuntimeTraceEvent {
  return {
    ...event,
    attributes: sanitizeTraceAttributes(event.attributes, options.contentCapture ?? "metadata")
  };
}

export function sanitizeTraceAttributes(
  attributes: Record<string, unknown>,
  contentCapture: AicfTraceContentCapture = "metadata"
): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const sanitizedValue = sanitizeTraceValue(key, value, contentCapture);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }

  return sanitized;
}

export function createTraceEvent(input: {
  attributes?: Record<string, unknown>;
  contentCapture?: AicfTraceContentCapture;
  message?: string;
  requestId: string;
  runId: string;
  timestamp?: string;
  type: AicfRuntimeTraceEvent["type"];
}): AicfRuntimeTraceEvent {
  return {
    attributes: sanitizeTraceAttributes(input.attributes ?? {}, input.contentCapture ?? "metadata"),
    message: input.message,
    requestId: input.requestId,
    runId: input.runId,
    timestamp: input.timestamp ?? new Date(0).toISOString(),
    type: input.type
  };
}

export function traceContextRedactionPolicy(): DefaultRedactionPolicy {
  return new DefaultRedactionPolicy();
}

function sanitizeTraceValue(
  key: string,
  value: unknown,
  contentCapture: AicfTraceContentCapture
): JsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (contentCapture === "none" && contentKeyPattern.test(key)) {
    return undefined;
  }

  if (contentCapture === "metadata" && contentKeyPattern.test(key)) {
    return summarizeContentValue(value);
  }

  if (sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return contentCapture === "redacted_content" ? redactSensitiveText(value) : value;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value as number) || typeof value !== "number" ? value as JsonValue : String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item, index) => sanitizeTraceValue(`${key}_${index}`, item, contentCapture))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (isRecord(value)) {
    const securityRedacted = sanitizeClassifiedTraceRecord(key, value);
    if (securityRedacted !== undefined) {
      return securityRedacted;
    }

    const nested: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeTraceValue(childKey, childValue, contentCapture);
      if (sanitized !== undefined) {
        nested[childKey] = sanitized;
      }
    }
    return nested;
  }

  return String(value);
}

function sanitizeClassifiedTraceRecord(key: string, value: Record<string, unknown>): JsonValue | undefined {
  const classifications = readClassifications(value);
  if (classifications.length === 0) {
    return undefined;
  }

  const segment = createContextSegment({
    content: value.content ?? value.value ?? value.text ?? value.payload ?? value,
    dataClassifications: classifications,
    id: typeof value.id === "string" ? value.id : key,
    instructionsAllowed: false,
    label: typeof value.label === "string" ? value.label : key,
    trust: readTrust(value)
  });
  const result = redactForTrace(segment.content, {
    boundary: "trace",
    path: key,
    segment
  }, defaultSecurityRedactionPolicy());

  if (result.status === "denied") {
    return "[REDACTED]";
  }

  if (result.status === "redacted") {
    return toJsonValue({
      classifications,
      redacted: true,
      value: result.value
    });
  }

  return undefined;
}

function readClassifications(value: Record<string, unknown>): DataClassification[] {
  const raw = value.dataClassifications ?? value.data_classifications ?? value.classifications ?? value.classification;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const allowed = new Set<DataClassification>([
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
  return values
    .map((entry) => String(entry).toLowerCase().replace(/[^a-z0-9]+/g, "_"))
    .filter((entry): entry is DataClassification => allowed.has(entry as DataClassification));
}

function readTrust(value: Record<string, unknown>): TrustLabel {
  const trust = typeof value.trust === "string" ? value.trust : "";
  const allowed = new Set<TrustLabel>([
    "system_instruction",
    "developer_instruction",
    "app_policy",
    "app_data",
    "tool_result",
    "retrieved_document",
    "user_input",
    "model_output",
    "external_api"
  ]);
  return allowed.has(trust as TrustLabel) ? trust as TrustLabel : "app_data";
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function summarizeContentValue(value: unknown): JsonValue {
  if (typeof value === "string") {
    return {
      characters: value.length,
      omitted: true
    };
  }

  if (Array.isArray(value)) {
    return {
      items: value.length,
      omitted: true
    };
  }

  if (isRecord(value)) {
    return {
      keys: Object.keys(value).sort(),
      omitted: true
    };
  }

  return {
    omitted: true
  };
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\b\d{12,19}\b/g, "[REDACTED]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
