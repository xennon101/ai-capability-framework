import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName
} from "./adapter-common.js";
import type {
  BuildSemanticKernelFunctionsOptions,
  CapabilitySlice,
  ManifestRegistry,
  ParseSemanticKernelFunctionCallResult,
  SemanticKernelFunction,
  SemanticKernelFunctionCall,
  SemanticKernelFunctionNameOptions,
  SemanticKernelFunctionSet
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxFunctionNameLength = 64;
const pluginName = "aicf";

export function buildSemanticKernelFunctions(
  registry: ManifestRegistry | CapabilitySlice,
  options: BuildSemanticKernelFunctionsOptions
): SemanticKernelFunctionSet {
  const built = buildAdapterToolset<SemanticKernelFunction>({
    adapterName: "Semantic Kernel",
    buildTool: ({ loadedCapability, normalizedInputSchema, restricted, toolName }) => ({
      description: adapterToolDescription(loadedCapability.manifest),
      metadata: {
        autonomyTier: loadedCapability.manifest.autonomy_tier,
        capabilityId: loadedCapability.manifest.id,
        capabilityType: loadedCapability.manifest.capability_type,
        restricted,
        riskTier: loadedCapability.manifest.risk_tier
      },
      name: toolName,
      parameters: normalizedInputSchema,
      pluginName
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
    functions: built.tools
  };
}

export function parseSemanticKernelFunctionCall(
  functionSet: SemanticKernelFunctionSet,
  call: SemanticKernelFunctionCall
): ParseSemanticKernelFunctionCallResult {
  const shapeError = validateSemanticKernelFunctionCall(call);
  if (shapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: shapeError,
        path: "function_call"
      }],
      valid: false
    };
  }

  const functionName = call.functionName ?? call.name ?? "";

  return parseAdapterToolCall({
    argumentsPath: "function_call.arguments",
    bindings: functionSet.bindings,
    callId: call.id,
    rawArguments: call.arguments,
    toolName: stripPluginPrefix(functionName),
    toolNamePath: "function_call.functionName"
  });
}

export function toSemanticKernelFunctionName(
  capabilityId: string,
  options: SemanticKernelFunctionNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxFunctionNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateSemanticKernelFunctionCall(call: SemanticKernelFunctionCall): string | null {
  if (!isRecord(call)) {
    return "Semantic Kernel function call must be an object.";
  }

  const name = call.functionName ?? call.name;
  if (typeof name !== "string" || name.length === 0) {
    return "Semantic Kernel function call functionName or name is required.";
  }

  if (!isRecord(call.arguments)) {
    return "Semantic Kernel function call arguments must be a JSON object.";
  }

  return null;
}

function stripPluginPrefix(functionName: string): string {
  const prefix = `${pluginName}.`;
  return functionName.startsWith(prefix) ? functionName.slice(prefix.length) : functionName;
}
