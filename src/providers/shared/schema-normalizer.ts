import type { AicfDiagnostic, JsonObject } from "../../types.js";
import type { NormalizeProviderToolSchemaOptions, NormalizeProviderToolSchemaResult } from "./types.js";

const defaultUnsupportedKeywords = [
  "$ref",
  "allOf",
  "anyOf",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "not",
  "oneOf",
  "patternProperties",
  "prefixItems",
  "then",
  "unevaluatedProperties"
];

export function normalizeProviderToolSchema(
  schema: JsonObject,
  options: NormalizeProviderToolSchemaOptions = {}
): NormalizeProviderToolSchemaResult {
  const originalSchema = clone(schema);
  const normalizedSchema = clone(schema);
  const diagnostics: AicfDiagnostic[] = [];
  const path = options.path ?? "input_schema";

  if (!isObjectSchema(normalizedSchema)) {
    diagnostics.push({
      code: "provider_schema_unsupported",
      message: "Provider tool schemas must have an object root.",
      path
    });
  }

  const unsupportedKeywords = options.unsupportedKeywords ?? defaultUnsupportedKeywords;
  for (const keyword of unsupportedKeywords) {
    const keywordPath = findKeyword(normalizedSchema, keyword);
    if (keywordPath) {
      diagnostics.push({
        code: "provider_schema_unsupported",
        details: { keyword },
        message: `Provider tool schema contains unsupported keyword "${keyword}".`,
        path: `${path}${keywordPath}`
      });
    }
  }

  if (diagnostics.length > 0) {
    return {
      diagnostics,
      originalSchema,
      valid: false
    };
  }

  return {
    diagnostics,
    normalizedSchema,
    originalSchema,
    valid: true
  };
}

function isObjectSchema(schema: JsonObject): boolean {
  return schema.type === "object";
}

function findKeyword(value: unknown, keyword: string, path = ""): string | null {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findKeyword(child, keyword, `${path}/${index}`);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(value, keyword)) {
    return `${path}/${keyword}`;
  }

  for (const [key, child] of Object.entries(value)) {
    const found = findKeyword(child, keyword, `${path}/${key}`);
    if (found) return found;
  }

  return null;
}

function clone(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
