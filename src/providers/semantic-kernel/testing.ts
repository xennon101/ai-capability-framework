import type { SemanticKernelOpenApiDocument } from "./types.js";

export function isSemanticKernelOpenApiDocument(value: unknown): value is SemanticKernelOpenApiDocument {
  if (!isRecord(value)) return false;
  return value.openapi === "3.1.0" && isRecord(value.info) && isRecord(value.paths);
}

export function semanticKernelPathForToolName(providerToolName: string): string {
  return `/aicf/capabilities/${providerToolName}/execute`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
