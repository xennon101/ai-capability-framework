import type { AicfAuditEvent } from "../runtime/index.js";
import { sanitizeTraceEvent, type AicfRuntimeTraceEvent } from "../observability/index.js";
import type { AwsClientLike, DynamoDbStoreOptions } from "./types.js";

const sensitiveKeyPattern = /password|token|secret|api_?key|authorization|cookie|session|card|cvv|private_?key|provider_?payload|raw_?prompt|raw_?trace/i;
const unsafeContentKeyPattern = /raw|payload|prompt|trace|provider/i;

export function asAwsClient(client: unknown, label: string): AwsClientLike {
  if (!isRecord(client) || typeof client.send !== "function") {
    throw new Error(`${label} must expose a send(command) method.`);
  }

  return client as unknown as AwsClientLike;
}

export function partitionKey(options: DynamoDbStoreOptions, tenantId?: string, accountId?: string): string {
  const prefix = normalizePrefix(options.keyPrefix);
  return [
    ...(prefix ? [prefix] : []),
    "AICF",
    tenantId ?? options.defaultTenantId ?? "global",
    accountId ?? options.defaultAccountId ?? "global"
  ].join("#");
}

export function lookupKey(options: Pick<DynamoDbStoreOptions, "keyPrefix">, entity: string, id: string): string {
  const prefix = normalizePrefix(options.keyPrefix);
  return `${prefix ? `${prefix}#` : ""}${entity}#${id}`;
}

export function ttlEpochSeconds(options: DynamoDbStoreOptions, expiresAt?: string): number | undefined {
  if (expiresAt) {
    const parsed = Date.parse(expiresAt);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  if (options.ttlSeconds && options.ttlSeconds > 0) {
    const now = options.now?.() ?? new Date();
    return Math.floor(now.getTime() / 1000) + options.ttlSeconds;
  }

  return undefined;
}

export function metadataContext(metadata: Record<string, unknown> | undefined): {
  accountId?: string;
  capabilityId?: string;
  preparedActionId?: string;
  requestId?: string;
  runId?: string;
  subjectId?: string;
  tenantId?: string;
} {
  const aicf = isRecord(metadata?.aicf) ? metadata.aicf : {};
  return {
    accountId: stringValue(aicf.accountId),
    capabilityId: stringValue(aicf.capabilityId),
    preparedActionId: stringValue(aicf.preparedActionId),
    requestId: stringValue(aicf.requestId),
    runId: stringValue(aicf.runId),
    subjectId: stringValue(aicf.subjectId),
    tenantId: stringValue(aicf.tenantId)
  };
}

export function parseScopeContext(scope: string): { accountId?: string; capabilityId?: string; preparedActionId?: string; tenantId?: string } {
  const context: { accountId?: string; capabilityId?: string; preparedActionId?: string; tenantId?: string } = {};
  for (const segment of scope.split("|")) {
    const [key, ...valueParts] = segment.split(":");
    const value = valueParts.join(":");
    if (!value) {
      continue;
    }
    if (key === "tenant") context.tenantId = value;
    if (key === "account") context.accountId = value;
    if (key === "capability") context.capabilityId = value;
    if (key === "prepared") context.preparedActionId = value;
  }
  return context;
}

export function sanitizeAwsDetail(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value as number) || typeof value !== "number" ? value : String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(sanitizeAwsDetail)
      .filter((item) => item !== undefined);
  }

  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        sanitized[key] = "[REDACTED]";
        continue;
      }
      if (unsafeContentKeyPattern.test(key)) {
        sanitized[key] = summarizeValue(child);
        continue;
      }
      const childValue = sanitizeAwsDetail(child);
      if (childValue !== undefined) {
        sanitized[key] = childValue;
      }
    }
    return sanitized;
  }

  return String(value);
}

export function sanitizeAuditEvent(event: AicfAuditEvent): AicfAuditEvent {
  return {
    ...event,
    details: sanitizeAwsDetail(event.details) as Record<string, unknown> | undefined
  };
}

export function sanitizeTraceForAws(event: AicfRuntimeTraceEvent): AicfRuntimeTraceEvent {
  return sanitizeTraceEvent(event, { contentCapture: "metadata" });
}

export function nowIso(options: Pick<DynamoDbStoreOptions, "now">): string {
  return (options.now?.() ?? new Date()).toISOString();
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix) {
    return "";
  }
  return prefix.endsWith("#") ? prefix.slice(0, -1) : prefix;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizeValue(value: unknown): unknown {
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
