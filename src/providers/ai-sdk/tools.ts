import Ajv2020 from "ajv/dist/2020.js";
import { buildProviderToolDescriptor } from "../shared/tool-descriptor.js";
import { createProviderToolNameMap } from "../shared/name-mapper.js";
import { normalizeProviderToolSchema } from "../shared/schema-normalizer.js";
import { executeProviderToolCall } from "../shared/run-loop.js";
import type { AicfDiagnostic, JsonObject, LoadedCapabilityManifest } from "../../types.js";
import { createPlainAiSdkToolFactories } from "./factories.js";
import type {
  AicfAiSdkToolSet,
  BuildAiSdkToolsRequest
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export function buildAiSdkTools(request: BuildAiSdkToolsRequest): AicfAiSdkToolSet {
  const capabilities = exportableCapabilities(request);
  const toolNameMap = createProviderToolNameMap({
    capabilities,
    maxToolNameLength: request.maxToolNameLength,
    namePrefix: request.namePrefix,
    provider: "vercel-ai-sdk"
  });
  const diagnostics: AicfDiagnostic[] = [...toolNameMap.diagnostics];
  const factories = request.toolFactories ?? createPlainAiSdkToolFactories();
  const tools: Record<string, unknown> = {};

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
    const validate = ajv.compile(loadedCapability.manifest.input_schema);
    const inputSchema = factories.jsonSchema(descriptor.inputSchema, {
      validate: (value) => {
        if (validate(value)) {
          return {
            success: true,
            value
          };
        }

        return {
          error: new Error("AICF schema validation failed."),
          success: false
        };
      }
    });

    tools[descriptor.providerToolName] = factories.tool({
      description: descriptor.description,
      execute: async (args: unknown, executionContext?: Record<string, unknown>) => {
        const providerResult = await executeProviderToolCall({
          builtContext: request.builtContext,
          executor: request.executor,
          providerCall: {
            args: isRecord(args) ? { ...args } : {},
            callId: toolCallIdFromExecutionContext(executionContext),
            capabilityId: binding.capabilityId,
            provider: "vercel-ai-sdk",
            providerToolName: binding.providerToolName,
            rawProviderRef: {
              id: toolCallIdFromExecutionContext(executionContext),
              type: "ai-sdk-tool-call"
            }
          },
          registry: request.registry,
          runtimeContext: request.runtimeContext,
          runtimeSlice: request.slice,
          toolNameMap
        });
        return providerResult.envelope;
      },
      inputSchema,
      ...(request.includeApprovalMetadata && capabilityNeedsApprovalMetadata(loadedCapability) ? { needsApproval: true } : {}),
      ...(request.strict !== undefined ? { strict: request.strict } : {})
    });
  }

  return {
    diagnostics,
    toolNameMap,
    tools
  };
}

function exportableCapabilities(request: BuildAiSdkToolsRequest): LoadedCapabilityManifest[] {
  const ids = request.slice.items.map((item) => item.capabilityId);
  const candidates = ids
    .map((id) => request.registry.capabilityById.get(id))
    .filter((item): item is LoadedCapabilityManifest => Boolean(item));

  return candidates.filter((loadedCapability) => !isCommitCapability(loadedCapability));
}

function isCommitCapability(loadedCapability: LoadedCapabilityManifest): boolean {
  return loadedCapability.manifest.lifecycle.commit
    || loadedCapability.manifest.capability_type === "write_commit";
}

function capabilityNeedsApprovalMetadata(loadedCapability: LoadedCapabilityManifest): boolean {
  return Boolean(loadedCapability.manifest.policy.approval_required)
    || loadedCapability.manifest.risk_tier === "high"
    || loadedCapability.manifest.risk_tier === "critical";
}

function toolCallIdFromExecutionContext(executionContext: Record<string, unknown> | undefined): string | undefined {
  const nestedToolCall = isRecord(executionContext?.toolCall) ? executionContext.toolCall : undefined;
  const value = executionContext?.toolCallId ?? nestedToolCall?.toolCallId ?? executionContext?.id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
