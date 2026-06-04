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
  AicfAnthropicToolUseBlock,
  AicfAnthropicToolset,
  BuildAnthropicToolsOptions,
  ParseAnthropicToolUseBlocksResult
} from "./types.js";

export function buildAnthropicTools(options: BuildAnthropicToolsOptions): AicfAnthropicToolset {
  const capabilities = exportableCapabilities(options);
  const toolNameMap = createProviderToolNameMap({
    capabilities,
    maxToolNameLength: options.maxToolNameLength,
    namePrefix: options.namePrefix,
    provider: "anthropic"
  });
  const diagnostics: AicfDiagnostic[] = [...toolNameMap.diagnostics];
  const tools = [];

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
    tools.push({
      description: descriptor.description,
      input_schema: descriptor.inputSchema,
      name: descriptor.providerToolName,
      ...(options.strictTools ? { strict: true as const } : {})
    });
  }

  return {
    diagnostics,
    tools,
    toolNameMap
  };
}

export function extractAnthropicToolUseBlocks(
  response: { content?: unknown }
): AicfAnthropicToolUseBlock[] {
  if (!Array.isArray(response.content)) return [];
  return response.content.filter(isAnthropicToolUseBlock);
}

export function parseAnthropicToolUseBlocks(
  toolset: AicfAnthropicToolset,
  blocks: AicfAnthropicToolUseBlock[]
): ParseAnthropicToolUseBlocksResult {
  const diagnostics: ParseAnthropicToolUseBlocksResult["diagnostics"] = [];
  const parsed: AicfProviderToolCall[] = [];

  for (const [index, block] of blocks.entries()) {
    const blockDiagnostics = validateToolUseBlock(block, index);
    diagnostics.push(...blockDiagnostics);
    if (blockDiagnostics.length > 0) continue;

    const result = parseProviderToolCall({
      args: block.input,
      callId: block.id,
      provider: "anthropic",
      providerToolName: block.name ?? "",
      rawProviderRef: {
        id: block.id,
        type: "tool_use"
      },
      requireCallId: true,
      toolNameMap: toolset.toolNameMap
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

function exportableCapabilities(options: BuildAnthropicToolsOptions): LoadedCapabilityManifest[] {
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

function isAnthropicToolUseBlock(value: unknown): value is AicfAnthropicToolUseBlock {
  return isRecord(value) && value.type === "tool_use";
}

function validateToolUseBlock(
  block: AicfAnthropicToolUseBlock,
  index: number
): ParseAnthropicToolUseBlocksResult["diagnostics"] {
  const diagnostics: ParseAnthropicToolUseBlocksResult["diagnostics"] = [];
  if (!hasText(block.id)) {
    diagnostics.push({
      code: "provider_tool_call_id_missing",
      message: "Anthropic tool_use block is missing id.",
      path: `content/${index}/id`
    });
  }
  if (!hasText(block.name)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "Anthropic tool_use block is missing name.",
      path: `content/${index}/name`
    });
  }
  if (!isRecord(block.input)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "Anthropic tool_use input must be a JSON object.",
      path: `content/${index}/input`
    });
  }
  return diagnostics;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { AicfProviderToolNameMap };
