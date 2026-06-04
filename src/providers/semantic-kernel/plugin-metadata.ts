import { buildProviderToolDescriptor } from "../shared/tool-descriptor.js";
import { normalizeProviderToolSchema } from "../shared/schema-normalizer.js";
import type { JsonObject } from "../../types.js";
import {
  createSemanticKernelToolNameMap,
  defaultSemanticKernelTitle,
  defaultSemanticKernelVersion,
  exportableSemanticKernelCapabilities,
  lifecycleOperationForSemanticKernelCapability,
  semanticKernelApprovalRequired,
  semanticKernelPluginName,
  validateSemanticKernelServerUrl
} from "./helpers.js";
import type {
  SemanticKernelPluginMetadata,
  SemanticKernelPluginMetadataRequest
} from "./types.js";

export function exportSemanticKernelPluginMetadata(
  request: SemanticKernelPluginMetadataRequest
): SemanticKernelPluginMetadata {
  const serverUrl = validateSemanticKernelServerUrl(request.serverUrl);
  const capabilities = exportableSemanticKernelCapabilities(request);
  const toolNameMap = createSemanticKernelToolNameMap(request, capabilities);
  const functions: SemanticKernelPluginMetadata["functions"] = [];

  for (const loadedCapability of capabilities) {
    const binding = toolNameMap.bindingByCapabilityId.get(loadedCapability.manifest.id);
    if (!binding) continue;

    const normalized = normalizeProviderToolSchema(loadedCapability.manifest.input_schema as JsonObject, {
      path: `${loadedCapability.path}:input_schema`
    });
    if (!normalized.valid || !normalized.normalizedSchema) continue;

    const descriptor = buildProviderToolDescriptor({
      binding,
      loadedCapability,
      normalizedInputSchema: normalized.normalizedSchema
    });

    functions.push({
      approvalRequired: semanticKernelApprovalRequired(loadedCapability),
      capabilityId: loadedCapability.manifest.id,
      capabilityType: loadedCapability.manifest.capability_type,
      description: descriptor.description,
      lifecycleOperation: lifecycleOperationForSemanticKernelCapability(loadedCapability),
      name: binding.providerToolName,
      riskTier: loadedCapability.manifest.risk_tier
    });
  }

  return {
    description: "Descriptor metadata for importing selected AICF read and prepare capabilities into Semantic Kernel.",
    functions,
    mcp: {
      recommended: true,
      summary: "Use the AICF MCP server runtime when Semantic Kernel MCP plugin import is available.",
      warnings: semanticKernelMcpWarnings()
    },
    openapi: {
      ...(request.openApiDocumentUrl ? { documentUrl: request.openApiDocumentUrl } : {}),
      importHint: "Import the generated OpenAPI 3.1 document only for a host-owned executor route that enforces AICF auth, policy, approvals, idempotency, and audit.",
      serverUrl
    },
    pluginName: semanticKernelPluginName(request),
    provider: "semantic-kernel",
    schemaVersion: "1.0",
    title: request.title ?? defaultSemanticKernelTitle,
    version: request.version ?? defaultSemanticKernelVersion
  };
}

export function semanticKernelMcpWarnings(): string[] {
  return [
    "Expose only a routed capability slice, not the full registry.",
    "Do not list or execute commit capabilities as Semantic Kernel-callable functions.",
    "Resolve host authentication, account, tenant, entitlement, and permissions before constructing runtime context.",
    "Treat approval-required envelopes as pauses; the host must collect and verify approvals before commit.",
    "Use caution with Semantic Kernel automatic function invocation because AICF remains the lifecycle and policy authority."
  ];
}
