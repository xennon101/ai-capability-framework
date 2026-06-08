const sensitiveKeyPattern = /^(accountId|actorId|apiKey|authorization|cardNumber|cookie|cvv|email|password|privateKey|providerPayload|rawPrompt|rawProviderPayload|rawTrace|rawTranscript|secret|sessionToken|tenantId|token|userId)$/i;
const sensitiveFragmentPattern = /(credential|private_diagnostics|provider[-_]?payload|raw[-_]?(prompt|provider|trace|transcript)|secret|token)/i;

export function sanitizeControlPlanePayload<T>(value: T): T {
  return sanitizeValue(value) as T;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = sanitizeValue(child);
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeyPattern.test(key) || sensitiveFragmentPattern.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
