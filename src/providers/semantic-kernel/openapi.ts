import { buildProviderToolDescriptor } from "../shared/tool-descriptor.js";
import { normalizeProviderToolSchema } from "../shared/schema-normalizer.js";
import type { AicfDiagnostic, JsonObject, LoadedCapabilityManifest } from "../../types.js";
import {
  createSemanticKernelToolNameMap,
  defaultSemanticKernelTitle,
  defaultSemanticKernelVersion,
  exportableSemanticKernelCapabilities,
  lifecycleOperationForSemanticKernelCapability,
  semanticKernelApprovalRequired,
  semanticKernelPluginName,
  semanticKernelSideEffectSummary,
  validateSemanticKernelServerUrl
} from "./helpers.js";
import type {
  SemanticKernelAicfOperationMetadata,
  SemanticKernelOpenApiDocument,
  SemanticKernelOpenApiExport,
  SemanticKernelOpenApiExportRequest,
  SemanticKernelOpenApiOperation
} from "./types.js";

export function exportSemanticKernelOpenApiPlugin(
  request: SemanticKernelOpenApiExportRequest
): SemanticKernelOpenApiExport {
  const serverUrl = validateSemanticKernelServerUrl(request.serverUrl);
  const capabilities = exportableSemanticKernelCapabilities(request);
  const toolNameMap = createSemanticKernelToolNameMap(request, capabilities);
  const diagnostics: AicfDiagnostic[] = [...toolNameMap.diagnostics];
  const paths: SemanticKernelOpenApiDocument["paths"] = {};
  const responseSchema = aicfEnvelopeSummarySchema();

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
    const operation = buildSemanticKernelOperation({
      descriptorDescription: descriptor.description,
      includeRiskMetadata: request.includeRiskMetadata !== false,
      inputSchema: normalized.normalizedSchema,
      loadedCapability,
      operationId: binding.providerToolName,
      responseSchema
    });

    paths[`/aicf/capabilities/${binding.providerToolName}/execute`] = {
      post: operation
    };
  }

  const document: SemanticKernelOpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: request.title ?? defaultSemanticKernelTitle,
      version: request.version ?? defaultSemanticKernelVersion
    },
    servers: [
      {
        url: serverUrl
      }
    ],
    paths,
    components: {
      schemas: {
        AicfToolResultEnvelope: responseSchema
      }
    },
    "x-aicf": {
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
      pluginName: semanticKernelPluginName(request),
      provider: "semantic-kernel",
      schemaVersion: "1.0"
    }
  };

  return {
    diagnostics,
    document,
    toolNameMap
  };
}

function buildSemanticKernelOperation(input: {
  descriptorDescription: string;
  includeRiskMetadata: boolean;
  inputSchema: JsonObject;
  loadedCapability: LoadedCapabilityManifest;
  operationId: string;
  responseSchema: JsonObject;
}): SemanticKernelOpenApiOperation {
  const capability = input.loadedCapability.manifest;
  const lifecycleOperation = lifecycleOperationForSemanticKernelCapability(input.loadedCapability);
  const xAicf: SemanticKernelAicfOperationMetadata = {
    approvalRequired: semanticKernelApprovalRequired(input.loadedCapability),
    capabilityId: capability.id,
    capabilityType: capability.capability_type,
    capabilityVersion: capability.version,
    lifecycleOperation,
    ...(input.includeRiskMetadata ? { riskTier: capability.risk_tier } : {}),
    sideEffects: semanticKernelSideEffectSummary(input.loadedCapability)
  };

  return {
    description: input.descriptorDescription,
    operationId: input.operationId,
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: executionRequestSchema(input.inputSchema)
        }
      }
    },
    responses: {
      "200": {
        description: "Model-safe AICF runtime envelope summary.",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/AicfToolResultEnvelope"
            } as JsonObject
          }
        }
      }
    },
    summary: capability.summary,
    "x-aicf": xAicf
  };
}

function executionRequestSchema(inputSchema: JsonObject): JsonObject {
  return {
    additionalProperties: false,
    properties: {
      args: inputSchema,
      runtime_context_ref: {
        description: "Opaque host-owned reference for resolving authenticated runtime context.",
        minLength: 1,
        type: "string"
      }
    },
    required: ["args", "runtime_context_ref"],
    type: "object"
  };
}

function aicfEnvelopeSummarySchema(): JsonObject {
  return {
    additionalProperties: false,
    properties: {
      action: {
        additionalProperties: true,
        type: "object"
      },
      capabilityId: {
        type: "string"
      },
      capabilityVersion: {
        type: "string"
      },
      data: {
        additionalProperties: true,
        type: "object"
      },
      errors: {
        items: {
          additionalProperties: true,
          type: "object"
        },
        type: "array"
      },
      operation: {
        enum: ["read", "prepare", "commit"],
        type: "string"
      },
      policy: {
        additionalProperties: true,
        type: "object"
      },
      requestId: {
        type: "string"
      },
      runId: {
        type: "string"
      },
      schemaVersion: {
        const: "1.0"
      },
      status: {
        enum: ["success", "prepared", "approval_required", "denied", "validation_error", "unavailable", "failed"],
        type: "string"
      },
      userMessage: {
        type: "string"
      }
    },
    required: ["schemaVersion", "capabilityId", "operation", "status"],
    type: "object"
  };
}
