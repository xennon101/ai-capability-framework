import { hashReplayValue } from "./hash.js";
import type { ReplayTrace } from "./types.js";

const sensitiveKeyPattern = /password|token|secret|api_?key|authorization|cookie|session|card|cvv|private_?key/i;
const sensitiveTextPattern = /(Bearer\s+[A-Za-z0-9._-]+)|(sk-[A-Za-z0-9_-]+)|(\b\d{12,19}\b)/g;

export function redactReplayTrace(trace: ReplayTrace): ReplayTrace {
  const redacted = redactValue(trace) as ReplayTrace;
  const fields = new Set(redacted.redaction.fieldsRedacted);
  collectRedactedFields(trace, redacted, "$", fields);

  return {
    ...redacted,
    redaction: {
      ...redacted.redaction,
      fieldsRedacted: [...fields].sort(),
      hashAlgorithm: "sha256",
      mode: redacted.redaction.mode === "unsafe_unredacted" ? "unsafe_unredacted" : "redacted"
    }
  };
}

export function redactedPlaceholder(value: unknown): unknown {
  if (typeof value === "string" && (sensitiveTextPattern.test(value) || value.includes("@"))) {
    sensitiveTextPattern.lastIndex = 0;
    return `[REDACTED:${hashReplayValue(value).slice(0, 12)}]`;
  }
  sensitiveTextPattern.lastIndex = 0;
  return value;
}

function redactValue(value: unknown, key = ""): unknown {
  if (key === "private_diagnostics") {
    return undefined;
  }

  if (typeof value === "string") {
    if (sensitiveKeyPattern.test(key)) {
      return "[REDACTED]";
    }
    return value.replace(sensitiveTextPattern, "[REDACTED]");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, key));
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === "private_diagnostics") {
        continue;
      }
      result[childKey] = sensitiveKeyPattern.test(childKey) ? "[REDACTED]" : redactValue(childValue, childKey);
    }
    return result;
  }

  return value;
}

function collectRedactedFields(original: unknown, redacted: unknown, currentPath: string, fields: Set<string>): void {
  if (original !== redacted && (typeof original !== "object" || original === null)) {
    fields.add(currentPath);
    return;
  }

  if (Array.isArray(original) && Array.isArray(redacted)) {
    original.forEach((entry, index) => collectRedactedFields(entry, redacted[index], `${currentPath}[${index}]`, fields));
    return;
  }

  if (!isRecord(original) || !isRecord(redacted)) {
    return;
  }

  for (const key of Object.keys(original)) {
    if (!(key in redacted)) {
      fields.add(`${currentPath}.${key}`);
      continue;
    }
    collectRedactedFields(original[key], redacted[key], `${currentPath}.${key}`, fields);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
