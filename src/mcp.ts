import {
  adapterToolDescription,
  buildAdapterToolset,
  isRecord,
  parseAdapterToolCall,
  toAdapterToolName,
  toJsonObject
} from "./adapter-common.js";
import type {
  BuildMcpToolDescriptorsOptions,
  CapabilityManifest,
  ManifestRegistry,
  McpToolCall,
  McpToolDescriptor,
  McpToolDescriptorSet,
  McpToolNameOptions,
  ParseMcpToolCallResult
} from "./types.js";

const defaultNamePrefix = "aicf_";
const maxToolNameLength = 64;

export function buildMcpToolDescriptors(
  registry: ManifestRegistry,
  options: BuildMcpToolDescriptorsOptions
): McpToolDescriptorSet {
  return buildAdapterToolset<McpToolDescriptor>({
    adapterName: "Model Context Protocol",
    buildTool: ({ loadedCapability, normalizedInputSchema, toolName }) => ({
      annotations: mcpAnnotations(loadedCapability.manifest),
      description: adapterToolDescription(loadedCapability.manifest),
      inputSchema: normalizedInputSchema,
      name: toolName,
      outputSchema: toJsonObject(loadedCapability.manifest.output_schema),
      title: loadedCapability.manifest.name
    }),
    context: options.context,
    defaultNamePrefix,
    includeRestricted: options.includeRestricted,
    maxToolNameLength,
    namePrefix: options.namePrefix,
    registry
  });
}

export function parseMcpToolCall(
  descriptorSet: McpToolDescriptorSet,
  call: McpToolCall
): ParseMcpToolCallResult {
  const shapeError = validateMcpToolCall(call);
  if (shapeError) {
    return {
      diagnostics: [{
        code: "invalid_tool_call",
        message: shapeError,
        path: "tools/call"
      }],
      valid: false
    };
  }

  return parseAdapterToolCall({
    argumentsPath: "tools/call.params.arguments",
    bindings: descriptorSet.bindings,
    rawArguments: call.params.arguments,
    toolName: call.params.name,
    toolNamePath: "tools/call.params.name"
  });
}

export function toMcpToolName(
  capabilityId: string,
  options: McpToolNameOptions = {}
): string {
  return toAdapterToolName(capabilityId, {
    maxLength: maxToolNameLength,
    namePrefix: options.namePrefix ?? defaultNamePrefix
  });
}

function validateMcpToolCall(call: McpToolCall): string | null {
  if (!isRecord(call)) {
    return "MCP tools/call request must be an object.";
  }

  if (!isRecord(call.params)) {
    return "MCP tools/call params must be an object.";
  }

  if (typeof call.params.name !== "string" || call.params.name.length === 0) {
    return "MCP tools/call params.name is required.";
  }

  if (!isRecord(call.params.arguments)) {
    return "MCP tools/call params.arguments must be a JSON object.";
  }

  return null;
}

function mcpAnnotations(capability: CapabilityManifest): McpToolDescriptor["annotations"] {
  const writes = capability.side_effects.writes_data
    || capability.side_effects.creates_records
    || capability.side_effects.updates_records
    || capability.side_effects.deletes_records;
  const openWorld = capability.side_effects.sends_external_messages
    || capability.side_effects.triggers_external_workflow;
  const destructive = capability.side_effects.deletes_records
    || capability.side_effects.changes_permissions
    || capability.side_effects.irreversible
    || capability.side_effects.charges_money
    || capability.side_effects.refunds_money;

  return {
    destructiveHint: destructive,
    idempotentHint: !destructive && (!writes || capability.idempotency?.required === true),
    openWorldHint: openWorld,
    readOnlyHint: capability.side_effects.reads_data && !writes && !openWorld && !destructive
  };
}
