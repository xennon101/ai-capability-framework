import type {
  AicfBuiltContext,
  AicfRuntimeContext,
  AicfRuntimeToolResultEnvelope,
  RuntimeCapabilitySlice
} from "../../runtime/index.js";
import type { AicfRuntimeTraceEvent, AicfTraceContentCapture, AicfTraceSink } from "../../observability/index.js";
import type { JsonObject, ManifestRegistry } from "../../types.js";
import type {
  AicfProviderToolCall,
  AicfProviderToolNameMap,
  AicfProviderToolResult
} from "../shared/types.js";
import type { AicfToolExecutor } from "../../runtime/index.js";

export interface AicfAnthropicToolDefinition {
  description: string;
  input_examples?: Record<string, unknown>[];
  input_schema: JsonObject;
  name: string;
  strict?: true;
}

export interface AicfAnthropicToolset {
  diagnostics: Array<{ code: string; message: string; path?: string; id?: string }>;
  tools: AicfAnthropicToolDefinition[];
  toolNameMap: AicfProviderToolNameMap;
}

export interface BuildAnthropicToolsOptions {
  maxToolNameLength?: number;
  namePrefix?: string;
  registry: ManifestRegistry;
  slice?: RuntimeCapabilitySlice;
  strictTools?: boolean;
}

export interface AicfAnthropicToolUseBlock {
  id?: string;
  input?: unknown;
  name?: string;
  type: "tool_use";
  [key: string]: unknown;
}

export interface AicfAnthropicToolResultBlock {
  content: string;
  is_error?: true;
  tool_use_id: string;
  type: "tool_result";
}

export interface AicfAnthropicMessage {
  content: unknown;
  role: "assistant" | "user";
  [key: string]: unknown;
}

export interface AicfAnthropicMessagesClient {
  messages: {
    create(input: Record<string, unknown>): Promise<AicfAnthropicMessageResponseLike>;
  };
}

export interface AicfAnthropicMessageResponseLike {
  content: Array<
    | { text: string; type: "text" }
    | AicfAnthropicToolUseBlock
    | Record<string, unknown>
  >;
  id?: string;
  role?: string;
  stop_reason?: string | null;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export type AicfAnthropicToolChoice =
  | "auto"
  | "none"
  | "any"
  | { name: string; type: "tool" };

export type AicfAnthropicRunStatus =
  | "completed"
  | "tool_limit_exceeded"
  | "turn_limit_exceeded"
  | "provider_error"
  | "failed";

export interface AicfAnthropicRunRequest {
  builtContext: AicfBuiltContext;
  client: AicfAnthropicMessagesClient;
  contentCapture?: AicfTraceContentCapture;
  executor: AicfToolExecutor;
  maxTokens?: number;
  maxToolCalls?: number;
  maxToolIterations?: number;
  messages: AicfAnthropicMessage[];
  model: string;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
  slice: RuntimeCapabilitySlice;
  strictTools?: boolean;
  system?: string;
  toolChoice?: AicfAnthropicToolChoice;
  traceSink?: AicfTraceSink;
}

export interface AicfAnthropicRunResult {
  errors: Array<{ code: string; message: string }>;
  finalText: string;
  iterations: number;
  provider: "anthropic";
  responseId?: string;
  status: AicfAnthropicRunStatus;
  stopReason?: string | null;
  toolCalls: AicfProviderToolCall[];
  toolResults: AicfRuntimeToolResultEnvelope[];
  traceEvents: AicfRuntimeTraceEvent[];
  usage?: Record<string, unknown>;
}

export interface ParseAnthropicToolUseBlocksResult {
  diagnostics: Array<{ code: string; message: string; path?: string }>;
  parsed: AicfProviderToolCall[];
  valid: boolean;
}

export interface BuildAnthropicToolResultMessageOptions {
  includeDiagnosticsForModel?: boolean;
}

export interface CreateDefaultAnthropicMessagesClientOptions {
  apiKey?: string;
  [key: string]: unknown;
}

export type AicfAnthropicProviderToolResult = AicfProviderToolResult;
