import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName
} from "./adapter-common.js";
import type {
  BuildLangChainToolDescriptorsOptions,
  LangChainToolCall,
  LangChainToolDescriptor,
  LangChainToolDescriptorSet,
  LangChainToolNameOptions,
  ManifestRegistry,
  ParseLangChainToolCallResult
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxToolNameLength = 64;

export function buildLangChainToolDescriptors(
  registry: ManifestRegistry,
  options: BuildLangChainToolDescriptorsOptions
): LangChainToolDescriptorSet {
  return buildAdapterToolset<LangChainToolDescriptor>({
    adapterName: "LangChain",
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
      schema: normalizedInputSchema
    }),
    context: options.context,
    defaultNamePrefix,
    includeRestricted: options.includeRestricted,
    maxToolNameLength,
    namePrefix: options.namePrefix,
    registry
  });
}

export function parseLangChainToolCall(
  descriptorSet: LangChainToolDescriptorSet,
  call: LangChainToolCall
): ParseLangChainToolCallResult {
  const shapeError = validateLangChainToolCall(call);
  if (shapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: shapeError,
        path: "tool_call"
      }],
      valid: false
    };
  }

  return parseAdapterToolCall({
    argumentsPath: "tool_call.args",
    bindings: descriptorSet.bindings,
    callId: call.id,
    rawArguments: call.args,
    toolName: call.name,
    toolNamePath: "tool_call.name"
  });
}

export function toLangChainToolName(
  capabilityId: string,
  options: LangChainToolNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxToolNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateLangChainToolCall(call: LangChainToolCall): string | null {
  if (!isRecord(call)) {
    return "LangChain tool call must be an object.";
  }

  if (typeof call.name !== "string" || call.name.length === 0) {
    return "LangChain tool call name is required.";
  }

  if (!isRecord(call.args)) {
    return "LangChain tool call args must be a JSON object.";
  }

  return null;
}
