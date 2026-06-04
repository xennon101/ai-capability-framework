import { DefaultRedactionPolicy } from "../runtime/index.js";
import type { JsonValue } from "../types.js";
import type {
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceRedactionOptions
} from "./types.js";

const sensitiveKeyPattern = /password|token|secret|api_?key|authorization|cookie|session|card|cvv|private_?key|provider_?payload|raw_?prompt|raw_?trace/i;
const contentKeyPattern = /prompt|input|output|message|content|text|payload|trace|provider/i;

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
