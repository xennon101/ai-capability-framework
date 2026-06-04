import { isRestrictedCapability } from "../../adapter-common.js";
import type { AicfDiagnostic, JsonObject, LoadedCapabilityManifest } from "../../types.js";
import { createProviderToolNameMap, toProviderToolName } from "../shared/name-mapper.js";
import { normalizeProviderToolSchema } from "../shared/schema-normalizer.js";
import { parseProviderToolCall } from "../shared/tool-call.js";
import type { AicfProviderToolNameMap } from "../shared/types.js";
import {
  mcpAnnotationsForCapability,
  mcpApprovalRequiredForCapability,
  mcpSideEffectSummaryForCapability
} from "./annotations.js";
import { mcpSecuritySummaryForCapability } from "./security.js";
import type {
  BuildMcpProviderToolDescriptorsRequest,
  McpProviderExcludedCapability,
  McpProviderToolCallRequest,
  McpProviderToolDescriptor,
  McpProviderToolDescriptorSet,
  McpProviderToolNameOptions,
  ParseMcpProviderToolCallResult
} from "./types.js";

export function buildMcpProviderToolDescriptors(
  request: BuildMcpProviderToolDescriptorsRequest
): McpProviderToolDescriptorSet {
  const selected = selectedCapabilities(request);
  const diagnostics: AicfDiagnostic[] = [];
  const excluded: McpProviderExcludedCapability[] = [];
  const exportable = selected.filter((loadedCapability) => {
    const excludedCapability = excludedReason(loadedCapability, request.includeRestricted);
    if (!excludedCapability) return true;
    excluded.push(excludedCapability);
    diagnostics.push(...excludedCapability.diagnostics);
    return false;
  });
  const toolNameMap = createProviderToolNameMap({
    capabilities: exportable,
    maxToolNameLength: request.maxToolNameLength,
    namePrefix: request.namePrefix,
    provider: "mcp"
  });
  diagnostics.push(...toolNameMap.diagnostics);
  const tools: McpProviderToolDescriptor[] = [];

  for (const loadedCapability of exportable) {
    const binding = toolNameMap.bindingByCapabilityId.get(loadedCapability.manifest.id);
    if (!binding) {
      excluded.push({
        capabilityId: loadedCapability.manifest.id,
        diagnostics: toolNameMap.diagnostics.filter((diagnostic) => diagnostic.id === loadedCapability.manifest.id),
        path: loadedCapability.path,
        reason: "tool_name_collision"
      });
      continue;
    }

    const normalized = normalizeProviderToolSchema(loadedCapability.manifest.input_schema as JsonObject, {
      path: `${loadedCapability.path}:input_schema`
    });
    diagnostics.push(...normalized.diagnostics);
    if (!normalized.valid || !normalized.normalizedSchema) {
      excluded.push({
        capabilityId: loadedCapability.manifest.id,
        diagnostics: normalized.diagnostics,
        path: loadedCapability.path,
        reason: "unsupported_schema"
      });
      continue;
    }

    tools.push(mcpDescriptorForCapability({
      bindingName: binding.providerToolName,
      loadedCapability,
      normalizedInputSchema: normalized.normalizedSchema
    }));
  }

  return {
    bindings: toolNameMap.bindings,
    descriptors: tools,
    diagnostics,
    excluded,
    toolNameMap,
    tools
  };
}

export function parseMcpProviderToolCall(
  toolset: McpProviderToolDescriptorSet,
  call: McpProviderToolCallRequest
): ParseMcpProviderToolCallResult {
  const diagnostics = validateMcpProviderToolCall(call);
  if (diagnostics.length > 0) {
    return {
      diagnostics,
      valid: false
    };
  }

  return parseProviderToolCall({
    args: call.params.arguments,
    provider: "mcp",
    providerToolName: call.params.name,
    rawProviderRef: {
      type: "tools/call"
    },
    toolNameMap: toolset.toolNameMap
  });
}

export function toMcpProviderToolName(
  capabilityId: string,
  options: McpProviderToolNameOptions = {}
): string {
  return toProviderToolName(capabilityId, {
    maxLength: options.maxLength,
    namePrefix: options.namePrefix,
    provider: "mcp"
  });
}

function selectedCapabilities(request: BuildMcpProviderToolDescriptorsRequest): LoadedCapabilityManifest[] {
  const selected: LoadedCapabilityManifest[] = [];
  for (const item of request.slice.items) {
    const loadedCapability = request.registry.capabilityById.get(item.capabilityId);
    if (loadedCapability) {
      selected.push(loadedCapability);
    }
  }
  return selected;
}

function excludedReason(
  loadedCapability: LoadedCapabilityManifest,
  includeRestricted: boolean | undefined
): McpProviderExcludedCapability | null {
  const capability = loadedCapability.manifest;
  if (capability.lifecycle.commit || capability.capability_type === "write_commit") {
    return exclusion(loadedCapability, "commit", "Commit capabilities are not exported as MCP model-callable tools.");
  }

  if (isRestrictedCapability(capability) && !includeRestricted) {
    return exclusion(loadedCapability, "restricted", "Restricted side-effect capabilities are not exported to MCP tools by default.");
  }

  return null;
}

function exclusion(
  loadedCapability: LoadedCapabilityManifest,
  reason: McpProviderExcludedCapability["reason"],
  message: string
): McpProviderExcludedCapability {
  return {
    capabilityId: loadedCapability.manifest.id,
    diagnostics: [{
      code: "capability_excluded",
      id: loadedCapability.manifest.id,
      kind: "capability",
      message,
      path: loadedCapability.path
    }],
    path: loadedCapability.path,
    reason
  };
}

function mcpDescriptorForCapability(input: {
  bindingName: string;
  loadedCapability: LoadedCapabilityManifest;
  normalizedInputSchema: JsonObject;
}): McpProviderToolDescriptor {
  const capability = input.loadedCapability.manifest;
  const lifecycleOperation = capability.lifecycle.prepare ? "prepare" : "read";
  return {
    _meta: {
      aicf: {
        approvalRequired: mcpApprovalRequiredForCapability(input.loadedCapability),
        capabilityId: capability.id,
        capabilityType: capability.capability_type,
        capabilityVersion: capability.version,
        lifecycleOperation,
        riskTier: capability.risk_tier,
        security: mcpSecuritySummaryForCapability(input.loadedCapability),
        sideEffects: mcpSideEffectSummaryForCapability(input.loadedCapability)
      }
    },
    annotations: mcpAnnotationsForCapability(input.loadedCapability),
    description: mcpToolDescription(input.loadedCapability),
    inputSchema: input.normalizedInputSchema,
    name: input.bindingName,
    outputSchema: cloneJsonObject(capability.output_schema),
    title: capability.name
  };
}

function mcpToolDescription(loadedCapability: LoadedCapabilityManifest): string {
  const capability = loadedCapability.manifest;
  const lifecycleOperation = capability.lifecycle.prepare ? "prepare" : "read";
  const whenToUse = (capability.when_to_use ?? []).join(" ");
  const whenNotToUse = (capability.when_not_to_use ?? []).join(" ");
  const approval = mcpApprovalRequiredForCapability(loadedCapability)
    ? "Approval may be required before any prepared action can be committed by the host."
    : "Approval is not normally required for this tool result.";

  return [
    capability.model_description.trim(),
    `Operation: ${lifecycleOperation}.`,
    lifecycleOperation === "prepare"
      ? "This tool prepares an action for host review; it does not commit side effects."
      : "This tool reads data or returns a safe summary; it does not commit side effects.",
    approval,
    whenToUse ? `Use when: ${whenToUse}` : "",
    whenNotToUse ? `Do not use when: ${whenNotToUse}` : "",
    `Capability ID: ${capability.id}. Risk: ${capability.risk_tier}.`
  ].filter(Boolean).join(" ");
}

function validateMcpProviderToolCall(call: McpProviderToolCallRequest): AicfDiagnostic[] {
  const diagnostics: AicfDiagnostic[] = [];
  if (!isRecord(call)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "MCP tools/call request must be an object.",
      path: "tools/call"
    });
    return diagnostics;
  }

  if (!isRecord(call.params)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "MCP tools/call params must be an object.",
      path: "tools/call.params"
    });
    return diagnostics;
  }

  if (typeof call.params.name !== "string" || call.params.name.length === 0) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "MCP tools/call params.name is required.",
      path: "tools/call.params.name"
    });
  }

  if (call.params.arguments !== undefined && !isRecord(call.params.arguments)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      message: "MCP tools/call params.arguments must be a JSON object.",
      path: "tools/call.params.arguments"
    });
  }

  return diagnostics;
}

function cloneJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { AicfProviderToolNameMap };
