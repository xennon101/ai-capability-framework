import { buildProviderToolDescriptor } from "../shared/tool-descriptor.js";
import { createProviderToolNameMap } from "../shared/name-mapper.js";
import { normalizeProviderToolSchema } from "../shared/schema-normalizer.js";
import { executeProviderToolCall } from "../shared/run-loop.js";
import type { AicfDiagnostic, JsonObject, LoadedCapabilityManifest } from "../../types.js";
import {
  createPlainLangChainSchemaFactory,
  createPlainLangChainToolFactory
} from "./factories.js";
import type {
  AicfLangChainToolSet,
  BuildLangChainToolsRequest
} from "./types.js";

export function buildLangChainTools(request: BuildLangChainToolsRequest): AicfLangChainToolSet {
  const capabilities = exportableCapabilities(request);
  const toolNameMap = createProviderToolNameMap({
    capabilities,
    maxToolNameLength: request.maxToolNameLength,
    namePrefix: request.namePrefix,
    provider: "langchain"
  });
  const diagnostics: AicfDiagnostic[] = [...toolNameMap.diagnostics];
  const toolFactory = request.toolFactory ?? createPlainLangChainToolFactory();
  const schemaFactory = request.schemaFactory ?? createPlainLangChainSchemaFactory();
  const tools: unknown[] = [];

  for (const loadedCapability of capabilities) {
    const binding = toolNameMap.bindingByCapabilityId.get(loadedCapability.manifest.id);
    if (!binding) continue;

    const normalized = normalizeProviderToolSchema(loadedCapability.manifest.input_schema as JsonObject, {
      path: `${loadedCapability.path}:input_schema`
    });
    diagnostics.push(...normalized.diagnostics);
    if (!normalized.valid || !normalized.normalizedSchema) continue;

    const convertedSchema = schemaFactory.createSchema(normalized.normalizedSchema, {
      path: `${loadedCapability.path}:input_schema`
    });
    diagnostics.push(...convertedSchema.diagnostics);
    if (!convertedSchema.schema || convertedSchema.diagnostics.length > 0) continue;

    const descriptor = buildProviderToolDescriptor({
      binding,
      loadedCapability,
      normalizedInputSchema: normalized.normalizedSchema
    });

    tools.push(toolFactory.tool(
      async (args: unknown, config?: Record<string, unknown>) => {
        const providerResult = await executeProviderToolCall({
          builtContext: request.builtContext,
          executor: request.executor,
          providerCall: {
            args: isRecord(args) ? { ...args } : {},
            callId: toolCallIdFromConfig(config),
            capabilityId: binding.capabilityId,
            provider: "langchain",
            providerToolName: binding.providerToolName,
            rawProviderRef: {
              id: toolCallIdFromConfig(config),
              type: "langchain-tool-call"
            }
          },
          registry: request.registry,
          runtimeContext: request.runtimeContext,
          runtimeSlice: request.slice,
          toolNameMap
        });
        return providerResult.output;
      },
      {
        description: descriptor.description,
        metadata: {
          autonomyTier: loadedCapability.manifest.autonomy_tier,
          capabilityId: loadedCapability.manifest.id,
          capabilityType: loadedCapability.manifest.capability_type,
          restricted: binding.restricted,
          riskTier: loadedCapability.manifest.risk_tier
        },
        name: descriptor.providerToolName,
        schema: convertedSchema.schema
      }
    ));
  }

  return {
    diagnostics,
    toolNameMap,
    tools
  };
}

function exportableCapabilities(request: BuildLangChainToolsRequest): LoadedCapabilityManifest[] {
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

function toolCallIdFromConfig(config: Record<string, unknown> | undefined): string | undefined {
  const nestedToolCall = isRecord(config?.toolCall) ? config.toolCall : undefined;
  const configurable = isRecord(config?.configurable) ? config.configurable : undefined;
  const value = config?.toolCallId ?? nestedToolCall?.id ?? nestedToolCall?.toolCallId ?? configurable?.toolCallId ?? config?.id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
