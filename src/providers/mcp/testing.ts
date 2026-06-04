import type { McpProviderToolDescriptor } from "./types.js";

export function isMcpProviderToolDescriptor(value: unknown): value is McpProviderToolDescriptor {
  if (!isRecord(value)) return false;
  return typeof value.name === "string"
    && typeof value.description === "string"
    && isRecord(value.inputSchema)
    && isRecord(value._meta)
    && isRecord(value._meta.aicf);
}

export function createMcpProviderToolCall(input: {
  args?: Record<string, unknown>;
  name: string;
}): {
  method: "tools/call";
  params: {
    arguments: Record<string, unknown>;
    name: string;
  };
} {
  return {
    method: "tools/call",
    params: {
      arguments: input.args ?? {},
      name: input.name
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
