import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName
} from "./adapter-common.js";
import type {
  BuildOpenAIResponsesToolsOptions,
  OpenAIResponsesFunctionCall,
  OpenAIResponsesFunctionTool,
  OpenAIResponsesToolNameOptions,
  OpenAIResponsesToolset,
  ParseOpenAIResponsesToolCallResult
} from "./types.js";
import type { ManifestRegistry } from "./types.js";

const defaultNamePrefix = "aicf_";
const maxOpenAIToolNameLength = 64;

export function buildOpenAIResponsesTools(
  registry: ManifestRegistry,
  options: BuildOpenAIResponsesToolsOptions
): OpenAIResponsesToolset {
  return buildAdapterToolset<OpenAIResponsesFunctionTool>({
    adapterName: "OpenAI",
    buildTool: ({ loadedCapability, normalizedInputSchema, toolName }) => ({
      description: adapterToolDescription(loadedCapability.manifest),
      name: toolName,
      parameters: normalizedInputSchema,
      strict: true,
      type: "function"
    }),
    context: options.context,
    defaultNamePrefix,
    includeRestricted: options.includeRestricted,
    maxToolNameLength: maxOpenAIToolNameLength,
    namePrefix: options.namePrefix,
    registry
  });
}

export function parseOpenAIResponsesToolCall(
  toolset: OpenAIResponsesToolset,
  call: OpenAIResponsesFunctionCall
): ParseOpenAIResponsesToolCallResult {
  const callShapeError = validateToolCallShape(call);
  if (callShapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: callShapeError,
        path: "tool_call"
      }],
      valid: false
    };
  }

  return parseAdapterToolCall({
    argumentsPath: "tool_call.arguments",
    bindings: toolset.bindings,
    callId: call.call_id,
    id: call.id,
    rawArguments: call.arguments,
    rawArgumentsAreJsonString: true,
    toolName: call.name,
    toolNamePath: "tool_call.name"
  });
}

export function toOpenAIResponsesToolName(
  capabilityId: string,
  options: OpenAIResponsesToolNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxOpenAIToolNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateToolCallShape(call: OpenAIResponsesFunctionCall): string | null {
  if (!isRecord(call)) {
    return "OpenAI tool call must be an object.";
  }

  if (call.type !== "function_call") {
    return "OpenAI tool call type must be function_call.";
  }

  if (typeof call.name !== "string" || call.name.length === 0) {
    return "OpenAI tool call name is required.";
  }

  if (typeof call.arguments !== "string") {
    return "OpenAI tool call arguments must be a JSON string.";
  }

  return null;
}
