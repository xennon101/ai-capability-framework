import type {
  AicfContextItem,
  AicfRedaction,
  AicfRedactionPolicy,
  AicfRuntimeContext,
  JsonValue
} from "./types.js";

const sensitiveKeyPatterns = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "cardnumber",
  "card_number",
  "cvv",
  "privatekey",
  "private_key"
];

export class DefaultRedactionPolicy implements AicfRedactionPolicy {
  redact(input: {
    item: AicfContextItem;
    runtimeContext: AicfRuntimeContext;
  }): { item: AicfContextItem; redactions: AicfRedaction[] } {
    const redactions: AicfRedaction[] = [];
    const item = cloneItem(input.item);

    if (item.data) {
      item.data = redactRecord(item.data, {
        itemId: item.id,
        path: "data",
        redactions
      });
    }

    return {
      item,
      redactions
    };
  }
}

function redactRecord(
  value: Record<string, unknown>,
  context: {
    itemId: string;
    path: string;
    redactions: AicfRedaction[];
  }
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${context.path}.${key}`;
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
      context.redactions.push({
        itemId: context.itemId,
        path: childPath,
        reason: `Sensitive key "${key}" was redacted.`
      });
      continue;
    }

    if (isPlainRecord(child)) {
      result[key] = redactRecord(child, {
        ...context,
        path: childPath
      });
      continue;
    }

    if (Array.isArray(child)) {
      result[key] = child.map((entry, index) => isPlainRecord(entry)
        ? redactRecord(entry, {
          ...context,
          path: `${childPath}[${index}]`
        })
        : entry) as JsonValue[];
      continue;
    }

    result[key] = child;
  }

  return result;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return sensitiveKeyPatterns.some((pattern) => normalized.includes(pattern));
}

function cloneItem(item: AicfContextItem): AicfContextItem {
  return JSON.parse(JSON.stringify(item)) as AicfContextItem;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

