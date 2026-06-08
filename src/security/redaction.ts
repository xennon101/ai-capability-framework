import type {
  AicfSecurityReason,
  DataClassification,
  RedactionContext,
  RedactionEvent,
  RedactionMode,
  RedactionPolicy,
  RedactionResult,
  RedactionRule
} from "./types.js";

const sensitiveTraceClasses = new Set<DataClassification>([
  "customer_pii",
  "employee_pii",
  "payment_metadata",
  "financial",
  "health",
  "legal",
  "security_sensitive"
]);

const credentialClass = "credential_material" satisfies DataClassification;
const sensitiveKeyPattern = /password|token|secret|api_?key|authorization|cookie|session|card|cvv|private_?key/i;

export function defaultSecurityRedactionPolicy(): RedactionPolicy {
  return {
    defaultMode: "allow",
    id: "aicf.default_security_redaction",
    rules: [{
      dataClassifications: [credentialClass],
      id: "deny_credential_material",
      mode: "deny"
    }, {
      boundary: "trace",
      dataClassifications: [...sensitiveTraceClasses],
      id: "redact_sensitive_trace_content",
      mode: "redact"
    }, {
      boundary: "trace",
      paths: ["rawPrompt", "rawProviderPayload", "providerPayload", "rawTrace"],
      id: "deny_raw_trace_payload_fields",
      mode: "deny"
    }]
  };
}

export function redactForProvider<T>(
  value: T,
  context: RedactionContext,
  policy: RedactionPolicy = defaultSecurityRedactionPolicy()
): RedactionResult<T> {
  return redactValue(value, {
    ...context,
    boundary: "provider"
  }, policy);
}

export function redactForTrace<T>(
  value: T,
  context: RedactionContext,
  policy: RedactionPolicy = defaultSecurityRedactionPolicy()
): RedactionResult<T> {
  return redactValue(value, {
    ...context,
    boundary: "trace"
  }, policy);
}

function redactValue<T>(
  value: T,
  context: RedactionContext,
  policy: RedactionPolicy
): RedactionResult<T> {
  const rule = matchingRule(context, policy);
  const mode = rule?.mode ?? modeFromContext(context, policy.defaultMode);
  const path = context.path ?? "$";
  const reasons: AicfSecurityReason[] = [];
  const redactions: RedactionEvent[] = [];

  if (mode === "allow") {
    if (context.diagnosticMode === "unsafe_raw_content") {
      reasons.push(reason(
        "unsafe_diagnostic_raw_content",
        "Unsafe diagnostic raw-content mode was explicitly enabled.",
        "warning"
      ));
    }
    return {
      reasons,
      redactions,
      status: "allowed",
      value
    };
  }

  const classification = firstClassification(context);
  redactions.push({
    classification,
    mode,
    path,
    reason: mode === "deny" ? "Value was denied by the redaction policy." : "Value was redacted by the redaction policy.",
    ruleId: rule?.id
  });

  if (mode === "deny") {
    return {
      reasons: [reason("redaction_denied", "Value is not allowed across this boundary.")],
      redactions,
      status: "denied"
    };
  }

  return {
    reasons,
    redactions,
    status: "redacted",
    value: redactContent(value, context.boundary === "trace" && classification !== undefined && sensitiveTraceClasses.has(classification)) as T
  };
}

function matchingRule(context: RedactionContext, policy: RedactionPolicy): RedactionRule | undefined {
  return policy.rules.find((rule) => {
    if (rule.boundary && rule.boundary !== context.boundary) return false;
    if (rule.providerIds && (!context.providerId || !rule.providerIds.includes(context.providerId))) return false;
    if (rule.capabilityIds && (!context.capabilityId || !rule.capabilityIds.includes(context.capabilityId))) return false;
    if (rule.operations && (!context.operation || !rule.operations.includes(context.operation))) return false;
    if (rule.trustLabels && (!context.segment || !rule.trustLabels.includes(context.segment.trust))) return false;
    if (rule.dataClassifications && !rule.dataClassifications.some((classification) => context.segment?.dataClassifications.includes(classification))) return false;
    if (rule.paths && (!context.path || !rule.paths.includes(context.path))) return false;
    return true;
  });
}

function modeFromContext(context: RedactionContext, defaultMode: RedactionMode): RedactionMode {
  if (context.segment?.dataClassifications.includes(credentialClass)) {
    return "deny";
  }
  if (context.boundary === "trace" && context.segment?.dataClassifications.some((classification) => sensitiveTraceClasses.has(classification))) {
    return "redact";
  }
  if (context.path && /raw(prompt|providerpayload|trace)|providerpayload/i.test(context.path.replace(/[^a-z0-9]/gi, ""))) {
    return "deny";
  }
  return defaultMode;
}

function redactContent(value: unknown, redactAllScalars = false): unknown {
  if (typeof value === "string") {
    return redactAllScalars ? "[REDACTED]" : redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactContent(entry, redactAllScalars));
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactContent(child, redactAllScalars);
    }
    return result;
  }
  return value === undefined ? undefined : redactAllScalars ? "[REDACTED]" : value;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\b\d{12,19}\b/g, "[REDACTED]");
}

function firstClassification(context: RedactionContext): DataClassification | undefined {
  return context.segment?.dataClassifications[0];
}

function reason(code: string, message: string, severity: AicfSecurityReason["severity"] = "error"): AicfSecurityReason {
  return { code, message, severity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
