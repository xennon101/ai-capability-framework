import { buildAiSdkTools } from "../../ai-sdk.js";
import { buildAnthropicClaudeTools } from "../../anthropic-claude.js";
import { selectCapabilitySlice } from "../../capability-slice.js";
import { buildGeminiFunctionDeclarations } from "../../gemini.js";
import { buildLangChainToolDescriptors } from "../../langchain.js";
import { buildOpenAIResponsesTools } from "../../openai-responses.js";
import { exportSemanticKernelOpenApiPlugin } from "../semantic-kernel/index.js";
import { buildMcpProviderToolDescriptors } from "../mcp/index.js";
import type { AdapterToolBinding, AicfDiagnostic, CapabilitySlice } from "../../types.js";
import type { RuntimeCapabilitySlice } from "../../runtime/index.js";
import type {
  ProviderToolExportBinding,
  ProviderToolExportRequest,
  ProviderToolExportResult
} from "./types.js";

export function exportProviderTools(request: ProviderToolExportRequest): ProviderToolExportResult {
  const slice = selectedCoreSlice(request);
  const diagnostics: AicfDiagnostic[] = [...slice.diagnostics];
  let artifact: unknown;
  let bindings: ProviderToolExportBinding[] = [];
  let providerToolNames: string[] = [];

  switch (request.provider) {
    case "openai": {
      const toolset = buildOpenAIResponsesTools(slice, { context: request.context });
      artifact = stripDiagnostics(toolset, request.includeDiagnostics);
      diagnostics.push(...toolset.diagnostics);
      bindings = coreBindings(toolset.bindings);
      providerToolNames = toolset.tools.map((tool) => tool.name);
      break;
    }
    case "anthropic": {
      const toolset = buildAnthropicClaudeTools(slice, { context: request.context });
      artifact = stripDiagnostics(toolset, request.includeDiagnostics);
      diagnostics.push(...toolset.diagnostics);
      bindings = coreBindings(toolset.bindings);
      providerToolNames = toolset.tools.map((tool) => tool.name);
      break;
    }
    case "gemini": {
      const toolset = buildGeminiFunctionDeclarations(slice, { context: request.context });
      artifact = stripDiagnostics(toolset, request.includeDiagnostics);
      diagnostics.push(...toolset.diagnostics);
      bindings = coreBindings(toolset.bindings);
      providerToolNames = toolset.functionDeclarations.map((tool) => tool.name);
      break;
    }
    case "ai-sdk": {
      const toolset = buildAiSdkTools(slice, { context: request.context });
      artifact = stripDiagnostics(toolset, request.includeDiagnostics);
      diagnostics.push(...toolset.diagnostics);
      bindings = coreBindings(toolset.bindings);
      providerToolNames = Object.keys(toolset.tools);
      break;
    }
    case "langchain": {
      const toolset = buildLangChainToolDescriptors(slice, { context: request.context });
      artifact = stripDiagnostics(toolset, request.includeDiagnostics);
      diagnostics.push(...toolset.diagnostics);
      bindings = coreBindings(toolset.bindings);
      providerToolNames = toolset.tools.map((tool) => tool.name);
      break;
    }
    case "mcp": {
      const toolset = buildMcpProviderToolDescriptors({
        includeRestricted: request.includeRestricted,
        registry: request.registry,
        slice: runtimeSliceFromCoreSlice(slice)
      });
      artifact = stripDiagnostics(toolset, request.includeDiagnostics);
      diagnostics.push(...toolset.diagnostics);
      bindings = providerBindings(toolset.bindings);
      providerToolNames = toolset.tools.map((tool) => tool.name);
      break;
    }
    case "semantic-kernel": {
      if (!request.serverUrl) {
        diagnostics.push({
          code: "invalid_context",
          message: "Semantic Kernel provider export requires serverUrl.",
          path: "serverUrl"
        });
        artifact = {};
        break;
      }

      const exported = exportSemanticKernelOpenApiPlugin({
        registry: request.registry,
        serverUrl: request.serverUrl,
        slice: runtimeSliceFromCoreSlice(slice)
      });
      diagnostics.push(...exported.diagnostics);
      artifact = request.includeDiagnostics ? exported : exported.document;
      bindings = providerBindings(exported.toolNameMap.bindings);
      providerToolNames = Object.keys(exported.document.paths);
      break;
    }
  }

  return {
    artifact,
    bindings,
    diagnostics,
    exportedCount: providerToolNames.length,
    provider: request.provider,
    providerToolNames
  };
}

function selectedCoreSlice(request: ProviderToolExportRequest): CapabilitySlice {
  return selectCapabilitySlice({
    capabilityIds: request.capabilityIds,
    context: request.context,
    includeRestricted: request.includeRestricted,
    registry: request.registry
  });
}

function runtimeSliceFromCoreSlice(slice: CapabilitySlice): RuntimeCapabilitySlice {
  return {
    excluded: slice.excluded.map((excluded) => ({
      capabilityId: excluded.capabilityId,
      reason: excluded.reason
    })),
    items: slice.capabilities.map((capability) => ({
      capabilityId: capability.manifest.id,
      exposedOperations: capability.manifest.lifecycle.prepare ? ["select", "prepare"] : ["select"],
      reasons: ["provider conformance slice"],
      score: 1
    })),
    warnings: []
  };
}

function coreBindings(bindings: AdapterToolBinding[]): ProviderToolExportBinding[] {
  return bindings.map((binding) => ({
    capabilityId: binding.capabilityId,
    operation: binding.capabilityType === "write_commit" ? "commit" : binding.capabilityType === "write_prepare_only" ? "prepare" : "read",
    providerToolName: binding.toolName,
    restricted: binding.restricted
  }));
}

function providerBindings(bindings: Array<{
  capabilityId: string;
  operation: "read" | "prepare" | "commit";
  providerToolName: string;
  restricted: boolean;
}>): ProviderToolExportBinding[] {
  return bindings.map((binding) => ({
    capabilityId: binding.capabilityId,
    operation: binding.operation,
    providerToolName: binding.providerToolName,
    restricted: binding.restricted
  }));
}

function stripDiagnostics<T extends { diagnostics?: unknown }>(value: T, includeDiagnostics: boolean | undefined): T {
  if (includeDiagnostics) {
    return value;
  }

  const clone = JSON.parse(JSON.stringify(value)) as T;
  delete clone.diagnostics;
  return clone;
}
