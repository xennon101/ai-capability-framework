import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName
} from "./adapter-common.js";
import type {
  BuildGeminiFunctionDeclarationsOptions,
  CapabilitySlice,
  GeminiFunctionCall,
  GeminiFunctionDeclaration,
  GeminiFunctionDeclarationSet,
  GeminiFunctionNameOptions,
  ManifestRegistry,
  ParseGeminiFunctionCallResult
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxFunctionNameLength = 64;

export function buildGeminiFunctionDeclarations(
  registry: ManifestRegistry | CapabilitySlice,
  options: BuildGeminiFunctionDeclarationsOptions
): GeminiFunctionDeclarationSet {
  const built = buildAdapterToolset<GeminiFunctionDeclaration>({
    adapterName: "Google Gemini",
    buildTool: ({ loadedCapability, normalizedInputSchema, toolName }) => ({
      description: adapterToolDescription(loadedCapability.manifest),
      name: toolName,
      parameters: normalizedInputSchema
    }),
    context: options.context,
    defaultNamePrefix,
    includeDeprecated: options.includeDeprecated,
    includeDisabledForTests: options.includeDisabledForTests,
    includeDraft: options.includeDraft,
    includeExperimental: options.includeExperimental,
    includeRestricted: options.includeRestricted,
    maxToolNameLength: maxFunctionNameLength,
    namePrefix: options.namePrefix,
    registry
  });

  return {
    bindings: built.bindings,
    diagnostics: built.diagnostics,
    excluded: built.excluded,
    functionDeclarations: built.tools
  };
}

export function parseGeminiFunctionCall(
  declarationSet: GeminiFunctionDeclarationSet,
  call: GeminiFunctionCall
): ParseGeminiFunctionCallResult {
  const shapeError = validateGeminiFunctionCall(call);
  if (shapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: shapeError,
        path: "functionCall"
      }],
      valid: false
    };
  }

  return parseAdapterToolCall({
    argumentsPath: "functionCall.args",
    bindings: declarationSet.bindings,
    callId: call.id,
    rawArguments: call.args,
    toolName: call.name,
    toolNamePath: "functionCall.name"
  });
}

export function toGeminiFunctionName(
  capabilityId: string,
  options: GeminiFunctionNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxFunctionNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateGeminiFunctionCall(call: GeminiFunctionCall): string | null {
  if (!isRecord(call)) {
    return "Gemini functionCall must be an object.";
  }

  if (typeof call.name !== "string" || call.name.length === 0) {
    return "Gemini functionCall name is required.";
  }

  if (!isRecord(call.args)) {
    return "Gemini functionCall args must be a JSON object.";
  }

  return null;
}
