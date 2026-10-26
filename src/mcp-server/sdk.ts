import type { McpProviderToolDescriptor } from "../providers/mcp/index.js";
import { loadOptionalProviderDependency } from "../providers/shared/optional-dependency.js";
import type {
  AicfMcpToolResult,
  RegisterAicfMcpToolsOptions,
  RegisterAicfMcpToolsResult
} from "./types.js";

export async function registerAicfMcpTools(
  options: RegisterAicfMcpToolsOptions
): Promise<RegisterAicfMcpToolsResult> {
  const server = asMcpSdkServer(options.mcpServer);
  const list = await options.aicfServer.listTools(options.request ?? {});
  const convertSchema = isProtocolBackedServer(options.mcpServer)
    ? (await loadOptionalProviderDependency<{ fromJSONSchema: (schema: unknown) => unknown }>({
      dependencyName: "zod",
      provider: "mcp"
    })).fromJSONSchema
    : undefined;
  // Convert the complete list before registration so unsupported schemas cannot
  // leave a partially registered SDK server. Structural host adapters keep JSON Schema.
  const configs = list.tools.map((tool) => toolConfig(tool, convertSchema));
  const toolNames: string[] = [];

  for (const [index, tool] of list.tools.entries()) {
    const handler = async (args: unknown, extra?: unknown): Promise<AicfMcpToolResult> => {
      return options.aicfServer.callTool({
        ...(isRecord(options.request) ? options.request : {}),
        mcpExtra: extra,
        method: "tools/call",
        params: {
          arguments: isRecord(args) ? args : {},
          name: tool.name
        }
      });
    };

    if (server.registerTool) {
      server.registerTool(tool.name, configs[index]!, handler);
    } else if (server.tool) {
      server.tool(tool.name, tool.description, tool.inputSchema, handler);
    }
    toolNames.push(tool.name);
  }

  return {
    registered: toolNames.length,
    toolNames
  };
}

function toolConfig(
  tool: McpProviderToolDescriptor,
  convertSchema?: (schema: unknown) => unknown
): Record<string, unknown> {
  return {
    _meta: tool._meta,
    annotations: tool.annotations,
    description: tool.description,
    inputSchema: convertSchema ? convertSchema(tool.inputSchema) : tool.inputSchema,
    // MCP structuredContent contains the runtime envelope, whose data is the
    // manifest output. Validate that wire shape rather than the unwrapped data.
    outputSchema: convertSchema && tool.outputSchema ? convertSchema({
      type: "object",
      properties: {
        schemaVersion: { const: "1.0" },
        capabilityId: { type: "string" },
        capabilityVersion: { type: "string" },
        operation: { enum: ["read", "prepare"] },
        requestId: { type: "string" },
        runId: { type: "string" },
        status: { enum: ["success", "prepared", "approval_required", "denied", "failed", "unavailable", "validation_error"] },
        data: tool.outputSchema
      },
      // Protocol errors use a minimal envelope without capability data or identity.
      // The executor still validates successful data against the manifest schema.
      required: ["schemaVersion", "status"],
      additionalProperties: true
    }) : tool.outputSchema,
    title: tool.title
  };
}

function isProtocolBackedServer(server: unknown): boolean {
  return isRecord(server) && isRecord(server.server)
    && typeof server.server.setRequestHandler === "function"
    && typeof server.connect === "function";
}

function asMcpSdkServer(server: unknown): {
  registerTool?: (name: string, config: Record<string, unknown>, handler: (args: unknown, extra?: unknown) => Promise<AicfMcpToolResult>) => unknown;
  tool?: (name: string, description: string, inputSchema: unknown, handler: (args: unknown, extra?: unknown) => Promise<AicfMcpToolResult>) => unknown;
} {
  if (!isRecord(server)) {
    throw new Error("MCP SDK server must be an object.");
  }

  const registerTool = typeof server.registerTool === "function"
    ? server.registerTool.bind(server) as (name: string, config: Record<string, unknown>, handler: (args: unknown, extra?: unknown) => Promise<AicfMcpToolResult>) => unknown
    : undefined;
  const tool = typeof server.tool === "function"
    ? server.tool.bind(server) as (name: string, description: string, inputSchema: unknown, handler: (args: unknown, extra?: unknown) => Promise<AicfMcpToolResult>) => unknown
    : undefined;

  if (!registerTool && !tool) {
    throw new Error("MCP SDK server must expose registerTool() or tool().");
  }

  return {
    registerTool,
    tool
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
