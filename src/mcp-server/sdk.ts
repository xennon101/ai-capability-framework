import type { McpProviderToolDescriptor } from "../providers/mcp/index.js";
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
  const toolNames: string[] = [];

  for (const tool of list.tools) {
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
      server.registerTool(tool.name, toolConfig(tool), handler);
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

function toolConfig(tool: McpProviderToolDescriptor): Record<string, unknown> {
  return {
    _meta: tool._meta,
    annotations: tool.annotations,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    title: tool.title
  };
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
