import { buildProviderToolDescriptor } from "../shared/tool-descriptor.js";
import { createProviderToolNameMap } from "../shared/name-mapper.js";
import { normalizeProviderToolSchema } from "../shared/schema-normalizer.js";
import { parseProviderToolCall } from "../shared/tool-call.js";
import type { AicfDiagnostic, JsonObject, LoadedCapabilityManifest } from "../../types.js";
import type {
  AicfProviderToolCall,
  AicfProviderToolNameMap
} from "../shared/types.js";
import type {
  AicfGeminiFunctionCallLike,
  AicfGeminiFunctionDeclarationSet,
  AicfGeminiGenerateContentResponseLike,
  BuildGeminiFunctionDeclarationsOptions,
  ParseGeminiFunctionCallsResult
} from "./types.js";

export function buildGeminiFunctionDeclarations(
  options: BuildGeminiFunctionDeclarationsOptions
): AicfGeminiFunctionDeclarationSet {
  const capabilities = exportableCapabilities(options);
  const toolNameMap = createProviderToolNameMap({
    capabilities,
    maxToolNameLength: options.maxToolNameLength,
    namePrefix: options.namePrefix,
    provider: "gemini"
  });
  const diagnostics: AicfDiagnostic[] = [...toolNameMap.diagnostics];
  const functionDeclarations = [];

  for (const loadedCapability of capabilities) {
    const binding = toolNameMap.bindingByCapabilityId.get(loadedCapability.manifest.id);
    if (!binding) continue;

    const normalized = normalizeProviderToolSchema(loadedCapability.manifest.input_schema as JsonObject, {
      path: `${loadedCapability.path}:input_schema`
    });
    diagnostics.push(...normalized.diagnostics);
    if (!normalized.valid || !normalized.normalizedSchema) continue;

    const descriptor = buildProviderToolDescriptor({
      binding,
      loadedCapability,
      normalizedInputSchema: normalized.normalizedSchema
    });
    functionDeclarations.push({
      description: descriptor.description,
      name: descriptor.providerToolName,
      parameters: descriptor.inputSchema
    });
  }

  return {
    diagnostics,
    functionDeclarations,
    toolNameMap
  };
}

export function extractGeminiFunctionCalls(
  response: AicfGeminiGenerateContentResponseLike
): AicfGeminiFunctionCallLike[] {
  const calls: AicfGeminiFunctionCallLike[] = [];
  const seen = new Set<string>();
  for (const call of Array.isArray(response.functionCalls) ? response.functionCalls : []) {
    appendCall(calls, seen, call);
  }

  for (const candidate of Array.isArray(response.candidates) ? response.candidates : []) {
    const content = isRecord(candidate.content) ? candidate.content : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      if (isRecord(part) && isRecord(part.functionCall)) {
        appendCall(calls, seen, part.functionCall);
      }
    }
  }

  return calls;
}

export function parseGeminiFunctionCalls(
  declarationSet: AicfGeminiFunctionDeclarationSet,
  calls: AicfGeminiFunctionCallLike[]
): ParseGeminiFunctionCallsResult {
  const diagnostics: ParseGeminiFunctionCallsResult["diagnostics"] = [];
  const parsed: AicfProviderToolCall[] = [];

  for (const [index, call] of calls.entries()) {
    const callDiagnostics = validateFunctionCall(call, index);
    diagnostics.push(...callDiagnostics);
    if (callDiagnostics.length > 0) continue;

    const result = parseProviderToolCall({
      args: call.args,
      callId: call.id,
      provider: "gemini",
      providerToolName: call.name,
      rawProviderRef: {
        id: call.id,
        type: "functionCall"
      },
      toolNameMap: declarationSet.toolNameMap
    });
    diagnostics.push(...result.diagnostics);
    if (result.valid && result.parsed) {
      parsed.push(result.parsed);
    }
  }

  return {
    diagnostics,
    parsed,
    valid: diagnostics.length === 0
  };
}

function appendCall(
  calls: AicfGeminiFunctionCallLike[],
  seen: Set<string>,
  value: unknown
): void {
  if (!isRecord(value)) return;
  const call = {
    args: value.args,
    id: typeof value.id === "string" ? value.id : undefined,
    name: typeof value.name === "string" ? value.name : ""
  };
  const key = `${call.id ?? ""}:${call.name}:${JSON.stringify(call.args)}`;
  if (seen.has(key)) return;
  seen.add(key);
  calls.push(call);
}

function validateFunctionCall(
  call: AicfGeminiFunctionCallLike,
  index: number
): ParseGeminiFunctionCallsResult["diagnostics"] {
  const diagnostics: ParseGeminiFunctionCallsResult["diagnostics"] = [];
  if (!hasText(call.name)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "Gemini functionCall is missing name.",
      path: `functionCalls/${index}/name`
    });
  }
  if (!isRecord(call.args)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "Gemini functionCall args must be a JSON object.",
      path: `functionCalls/${index}/args`
    });
  }
  return diagnostics;
}

function exportableCapabilities(options: BuildGeminiFunctionDeclarationsOptions): LoadedCapabilityManifest[] {
  const ids = options.slice?.items.map((item) => item.capabilityId);
  const candidates = ids
    ? ids.map((id) => options.registry.capabilityById.get(id)).filter((item): item is LoadedCapabilityManifest => Boolean(item))
    : options.registry.capabilities;

  return candidates.filter((loadedCapability) => !isCommitCapability(loadedCapability));
}

function isCommitCapability(loadedCapability: LoadedCapabilityManifest): boolean {
  return loadedCapability.manifest.lifecycle.commit
    || loadedCapability.manifest.capability_type === "write_commit";
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { AicfProviderToolNameMap };
