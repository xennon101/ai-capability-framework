import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName
} from "./adapter-common.js";
import type {
  AnthropicClaudeTool,
  AnthropicClaudeToolNameOptions,
  AnthropicClaudeToolset,
  AnthropicClaudeToolUse,
  BuildAnthropicClaudeToolsOptions,
  ManifestRegistry,
  ParseAnthropicClaudeToolUseResult
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxToolNameLength = 64;

export function buildAnthropicClaudeTools(
  registry: ManifestRegistry,
  options: BuildAnthropicClaudeToolsOptions
): AnthropicClaudeToolset {
  return buildAdapterToolset<AnthropicClaudeTool>({
    adapterName: "Anthropic Claude",
    buildTool: ({ loadedCapability, normalizedInputSchema, toolName }) => ({
      description: adapterToolDescription(loadedCapability.manifest),
      input_schema: normalizedInputSchema,
      name: toolName,
      strict: true
    }),
    context: options.context,
    defaultNamePrefix,
    includeRestricted: options.includeRestricted,
    maxToolNameLength,
    namePrefix: options.namePrefix,
    registry
  });
}

export function parseAnthropicClaudeToolUse(
  toolset: AnthropicClaudeToolset,
  toolUse: AnthropicClaudeToolUse
): ParseAnthropicClaudeToolUseResult {
  const shapeError = validateAnthropicToolUse(toolUse);
  if (shapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: shapeError,
        path: "tool_use"
      }],
      valid: false
    };
  }

  return parseAdapterToolCall({
    argumentsPath: "tool_use.input",
    bindings: toolset.bindings,
    callId: toolUse.id,
    rawArguments: toolUse.input,
    toolName: toolUse.name,
    toolNamePath: "tool_use.name"
  });
}

export function toAnthropicClaudeToolName(
  capabilityId: string,
  options: AnthropicClaudeToolNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxToolNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateAnthropicToolUse(toolUse: AnthropicClaudeToolUse): string | null {
  if (!isRecord(toolUse)) {
    return "Anthropic Claude tool_use must be an object.";
  }

  if (toolUse.type !== undefined && toolUse.type !== "tool_use") {
    return "Anthropic Claude tool_use type must be tool_use when present.";
  }

  if (typeof toolUse.name !== "string" || toolUse.name.length === 0) {
    return "Anthropic Claude tool_use name is required.";
  }

  if (!isRecord(toolUse.input)) {
    return "Anthropic Claude tool_use input must be a JSON object.";
  }

  return null;
}
