import type {
  DecisionRequest,
  JsonObject,
  ManifestRegistry
} from "../types.js";
import type {
  McpProviderToolDescriptor,
  McpProviderToolDescriptorSet
} from "../providers/mcp/index.js";
import type {
  AicfBuiltContext,
  AicfCapabilityRouter,
  AicfContextBuilder,
  AicfRuntimeContext,
  AicfRuntimeToolResultEnvelope,
  AicfRuntimeUserInput,
  AicfToolExecutor
} from "../runtime/index.js";

export type AicfMcpRuntimeContextFactory =
  (input: { request: unknown }) => Promise<AicfRuntimeContext> | AicfRuntimeContext;

export interface AicfMcpRequestLike {
  method?: string;
  metadata?: Record<string, unknown>;
  params?: {
    arguments?: Record<string, unknown>;
    name?: string;
  };
  userInput?: Partial<AicfRuntimeUserInput> | string;
}

export interface AicfMcpServerOptions {
  contextBuilder: AicfContextBuilder;
  executor: AicfToolExecutor;
  includeRestricted?: boolean;
  maxCapabilities?: number;
  namePrefix?: string;
  registry: ManifestRegistry;
  router: AicfCapabilityRouter;
  runtimeContextFactory: AicfMcpRuntimeContextFactory;
}

export interface AicfMcpToolResult {
  content: Array<{
    text: string;
    type: "text";
  }>;
  isError?: boolean;
  structuredContent?: JsonObject;
}

export interface AicfMcpListToolsResult extends Pick<McpProviderToolDescriptorSet, "bindings" | "diagnostics" | "excluded" | "toolNameMap"> {
  tools: McpProviderToolDescriptor[];
}

export interface AicfMcpPreparedRequest {
  builtContext: AicfBuiltContext;
  decisionContext: DecisionRequest["context"];
  request: unknown;
  runtimeContext: AicfRuntimeContext;
  toolset: McpProviderToolDescriptorSet;
  userInput: AicfRuntimeUserInput;
}

export interface RegisterAicfMcpToolsOptions {
  aicfServer: {
    callTool(request: unknown): Promise<AicfMcpToolResult>;
    listTools(request: unknown): Promise<AicfMcpListToolsResult>;
  };
  mcpServer: unknown;
  request?: unknown;
}

export interface RegisterAicfMcpToolsResult {
  registered: number;
  toolNames: string[];
}

export type AicfMcpToolEnvelope = AicfRuntimeToolResultEnvelope;
