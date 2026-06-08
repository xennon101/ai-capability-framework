import { createHash } from "node:crypto";
import type {
  AuditDiagnosticMode,
  RedactedAccountRef,
  RedactedSubjectRef,
  RedactedTenantRef,
  RedactionSummary
} from "./types.js";

export function hashAuditValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

export function redactSubjectRef(
  subject: { actorType?: string; servicePrincipalId?: string; userId?: string } | string | undefined,
  diagnosticMode: AuditDiagnosticMode = "redacted"
): RedactedSubjectRef | undefined {
  const raw = typeof subject === "string" ? subject : subject?.userId ?? subject?.servicePrincipalId;
  if (!raw) {
    return undefined;
  }

  return {
    actorType: typeof subject === "object" ? subject.actorType : undefined,
    refHash: diagnosticMode === "unsafe_unredacted" ? `unsafe:${raw}` : hashAuditValue({ subject: raw })
  };
}

export function redactAccountRef(
  account: { accountId?: string } | string | undefined,
  diagnosticMode: AuditDiagnosticMode = "redacted"
): RedactedAccountRef | undefined {
  const raw = typeof account === "string" ? account : account?.accountId;
  if (!raw) {
    return undefined;
  }

  return {
    refHash: diagnosticMode === "unsafe_unredacted" ? `unsafe:${raw}` : hashAuditValue({ account: raw })
  };
}

export function redactTenantRef(
  tenant: { tenantId?: string } | string | undefined,
  diagnosticMode: AuditDiagnosticMode = "redacted"
): RedactedTenantRef | undefined {
  const raw = typeof tenant === "string" ? tenant : tenant?.tenantId;
  if (!raw) {
    return undefined;
  }

  return {
    refHash: diagnosticMode === "unsafe_unredacted" ? `unsafe:${raw}` : hashAuditValue({ tenant: raw })
  };
}

export function toRedactionSummary(
  fieldsRedacted: string[] = ["subject", "account", "tenant"],
  diagnosticMode: AuditDiagnosticMode = "redacted"
): RedactionSummary {
  return {
    fieldsRedacted: [...new Set(fieldsRedacted)].sort(),
    hashAlgorithm: "sha256",
    mode: diagnosticMode
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }

  return value;
}
