import {
  buildMcpProviderToolDescriptors,
  parseMcpProviderToolCall
} from "../providers/mcp/index.js";
import type {
  DecisionRequest,
  McpToolCall
} from "../types.js";
import {
  serializeToolEnvelopeForModel,
  type AicfRuntimeUserInput
} from "../runtime/index.js";
import type {
  AicfMcpListToolsResult,
  AicfMcpPreparedRequest,
  AicfMcpServerOptions,
  AicfMcpToolResult
} from "./types.js";

export class AicfMcpServer {
  private options: AicfMcpServerOptions;

  constructor(options: AicfMcpServerOptions) {
    this.options = options;
  }

  async listTools(request: unknown): Promise<AicfMcpListToolsResult> {
    try {
      const prepared = await this.prepareRequest(request);
      return {
        bindings: prepared.toolset.bindings,
        diagnostics: prepared.toolset.diagnostics,
        excluded: prepared.toolset.excluded,
        toolNameMap: prepared.toolset.toolNameMap,
        tools: prepared.toolset.tools
      };
    } catch {
      return {
        bindings: [],
        diagnostics: [{
          code: "invalid_context",
          message: "MCP runtime context could not be resolved.",
          path: "runtimeContextFactory"
        }],
        excluded: [],
        toolNameMap: emptyMcpToolNameMap(),
        tools: []
      };
    }
  }

  async callTool(request: unknown): Promise<AicfMcpToolResult> {
    let prepared: AicfMcpPreparedRequest;
    try {
      prepared = await this.prepareRequest(request);
    } catch {
      return mcpErrorResult("runtime_context_invalid", "MCP runtime context could not be resolved.");
    }

    const call = normalizeMcpToolCall(request);
    const parsed = parseMcpProviderToolCall(prepared.toolset, call);
    if (!parsed.valid || !parsed.parsed) {
      return mcpErrorResult(
        "invalid_tool_call",
        parsed.diagnostics[0]?.message ?? "MCP tool call was invalid.",
        parsed.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.path
        })),
        parsed.diagnostics.some((diagnostic) => diagnostic.code === "schema_validation_failed") ? "validation_error" : "failed"
      );
    }

    const capability = this.options.registry.capabilityById.get(parsed.parsed.capabilityId);
    if (!capability) {
      return mcpErrorResult("capability_not_found", "Capability was not found.");
    }

    const operation = operationForCapability(parsed.parsed.capabilityId, prepared);
    if (!operation) {
      return mcpErrorResult("commit_not_model_executable", "Commit capabilities are not exposed through MCP tools.");
    }

    try {
      const envelope = await this.options.executor.execute({
        args: parsed.parsed.args,
        builtContext: prepared.builtContext,
        capabilityId: parsed.parsed.capabilityId,
        operation,
        runtimeContext: prepared.runtimeContext,
        source: "model_tool_call"
      });
      return envelopeToMcpResult(envelope);
    } catch {
      return mcpErrorResult("tool_execution_failed", "MCP tool execution failed safely.");
    }
  }

  private async prepareRequest(request: unknown): Promise<AicfMcpPreparedRequest> {
    const runtimeContext = await this.options.runtimeContextFactory({ request });
    const userInput = normalizeUserInput(request);
    const builtContext = await this.options.contextBuilder.build({
      baseContext: runtimeContext,
      registry: this.options.registry,
      userInput
    });
    const runtimeSlice = await this.options.router.route({
      builtContext,
      includeRestricted: this.options.includeRestricted,
      maxCapabilities: this.options.maxCapabilities,
      registry: this.options.registry,
      userInput
    });
    const decisionContext = decisionContextFromRuntime(runtimeContext);
    const toolset = buildMcpProviderToolDescriptors({
      includeRestricted: this.options.includeRestricted,
      namePrefix: this.options.namePrefix,
      registry: this.options.registry,
      slice: runtimeSlice
    });

    return {
      builtContext,
      decisionContext,
      request,
      runtimeContext,
      toolset,
      userInput
    };
  }
}

function operationForCapability(
  capabilityId: string,
  prepared: AicfMcpPreparedRequest
): "read" | "prepare" | null {
  const item = prepared.toolset.bindings.find((binding) => binding.capabilityId === capabilityId);
  if (!item) {
    return null;
  }

  return item.operation === "prepare" ? "prepare" : item.operation === "read" ? "read" : null;
}

function decisionContextFromRuntime(runtimeContext: AicfMcpPreparedRequest["runtimeContext"]): DecisionRequest["context"] {
  return {
    autonomyTier: runtimeContext.autonomy.autonomyTier,
    permissions: [...runtimeContext.subject.permissions],
    riskCeiling: runtimeContext.autonomy.maxRiskTier,
    tenantId: runtimeContext.account.tenantId,
    userId: runtimeContext.subject.userId
  };
}

function normalizeMcpToolCall(request: unknown): McpToolCall {
  if (isRecord(request) && isRecord(request.params)) {
    return {
      method: request.method === "tools/call" ? "tools/call" : undefined,
      params: {
        arguments: isRecord(request.params.arguments) ? request.params.arguments : undefined,
        name: typeof request.params.name === "string" ? request.params.name : ""
      }
    };
  }

  if (isRecord(request)) {
    return {
      params: {
        arguments: isRecord(request.arguments) ? request.arguments : undefined,
        name: typeof request.name === "string" ? request.name : ""
      }
    };
  }

  return {
    params: {
      name: ""
    }
  };
}

function normalizeUserInput(request: unknown): AicfRuntimeUserInput {
  if (isRecord(request)) {
    if (typeof request.userInput === "string") {
      return {
        metadata: metadataFromRequest(request),
        text: request.userInput
      };
    }

    if (isRecord(request.userInput)) {
      return {
        metadata: isRecord(request.userInput.metadata) ? request.userInput.metadata : metadataFromRequest(request),
        text: typeof request.userInput.text === "string" ? request.userInput.text : ""
      };
    }

    if (typeof request.text === "string") {
      return {
        metadata: metadataFromRequest(request),
        text: request.text
      };
    }
  }

  return {
    metadata: isRecord(request) ? metadataFromRequest(request) : undefined,
    text: ""
  };
}

function metadataFromRequest(request: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(request.metadata) ? request.metadata : undefined;
}

function envelopeToMcpResult(envelope: Parameters<typeof serializeToolEnvelopeForModel>[0]): AicfMcpToolResult {
  const text = serializeToolEnvelopeForModel(envelope);
  const isError = ["denied", "failed", "unavailable", "validation_error"].includes(envelope.status);
  return {
    content: [{
      text,
      type: "text"
    }],
    isError,
    structuredContent: JSON.parse(text) as AicfMcpToolResult["structuredContent"]
  };
}

function mcpErrorResult(
  code: string,
  message: string,
  errors: Array<{ code: string; message: string; path?: string }> = [{ code, message }],
  status: "failed" | "validation_error" = "failed"
): AicfMcpToolResult {
  const structuredContent = {
    errors,
    schemaVersion: "1.0",
    status
  };
  return {
    content: [{
      text: JSON.stringify(structuredContent),
      type: "text"
    }],
    isError: true,
    structuredContent: structuredContent as AicfMcpToolResult["structuredContent"]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyMcpToolNameMap(): AicfMcpListToolsResult["toolNameMap"] {
  return {
    bindingByCapabilityId: new Map(),
    bindingByProviderToolName: new Map(),
    bindings: [],
    diagnostics: [],
    provider: "mcp",
    providerNameToCapabilityId() {
      return undefined;
    },
    toProviderToolName() {
      return undefined;
    }
  };
}

export type { McpProviderToolDescriptorSet as McpToolDescriptorSet } from "../providers/mcp/index.js";
