import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName
} from "./adapter-common.js";
import type {
  AiSdkTool,
  AiSdkToolCall,
  AiSdkToolNameOptions,
  AiSdkToolset,
  BuildAiSdkToolsOptions,
  ManifestRegistry,
  ParseAiSdkToolCallResult
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxToolNameLength = 64;

export function buildAiSdkTools(
  registry: ManifestRegistry,
  options: BuildAiSdkToolsOptions
): AiSdkToolset {
  const built = buildAdapterToolset<AiSdkTool>({
    adapterName: "Vercel AI SDK",
    buildTool: ({ loadedCapability, normalizedInputSchema }) => ({
      description: adapterToolDescription(loadedCapability.manifest),
      inputSchema: normalizedInputSchema,
      strict: true
    }),
    context: options.context,
    defaultNamePrefix,
    includeRestricted: options.includeRestricted,
    maxToolNameLength,
    namePrefix: options.namePrefix,
    registry
  });

  const tools: Record<string, AiSdkTool> = {};
  for (const [index, binding] of built.bindings.entries()) {
    const tool = built.tools[index];
    if (tool) {
      tools[binding.toolName] = tool;
    }
  }

  return {
    bindings: built.bindings,
    diagnostics: built.diagnostics,
    excluded: built.excluded,
    tools
  };
}

export function parseAiSdkToolCall(
  toolset: AiSdkToolset,
  call: AiSdkToolCall
): ParseAiSdkToolCallResult {
  const shapeError = validateAiSdkToolCall(call);
  if (shapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: shapeError,
        path: "toolCall"
      }],
      valid: false
    };
  }

  return parseAdapterToolCall({
    argumentsPath: call.input !== undefined ? "toolCall.input" : "toolCall.args",
    bindings: toolset.bindings,
    callId: call.toolCallId,
    rawArguments: call.input ?? call.args,
    toolName: call.toolName,
    toolNamePath: "toolCall.toolName"
  });
}

export function toAiSdkToolName(
  capabilityId: string,
  options: AiSdkToolNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxToolNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateAiSdkToolCall(call: AiSdkToolCall): string | null {
  if (!isRecord(call)) {
    return "AI SDK tool call must be an object.";
  }

  if (typeof call.toolName !== "string" || call.toolName.length === 0) {
    return "AI SDK tool call toolName is required.";
  }

  if (!isRecord(call.input ?? call.args)) {
    return "AI SDK tool call input or args must be a JSON object.";
  }

  return null;
}
