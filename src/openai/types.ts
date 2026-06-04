import type {
  AicfCapabilityRouter,
  AicfBuiltContext,
  AicfContextBuilder,
  AicfRuntimeContext,
  AicfRuntimeToolResultEnvelope,
  AicfRuntimeUserInput,
  AicfToolExecutor,
  CapabilitySlice,
  ManifestRegistry
} from "../runtime/index.js";
import type {
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceSink
} from "../observability/index.js";

export interface AicfOpenAIResponsesClient {
  responses: {
    create(input: Record<string, unknown>): Promise<AicfOpenAIResponseLike>;
  };
}

export interface AicfOpenAIResponseLike {
  id?: string;
  output?: unknown[];
  output_text?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export type AicfOpenAIRunStatus =
  | "completed"
  | "tool_limit_exceeded"
  | "turn_limit_exceeded"
  | "provider_error"
  | "failed";

export type AicfOpenAIRuntimeEvent = AicfRuntimeTraceEvent;

export interface AicfOpenAIRunRequest {
  client: AicfOpenAIResponsesClient;
  contentCapture?: AicfTraceContentCapture;
  contextBuilder: AicfContextBuilder;
  executor: AicfToolExecutor;
  maxToolCalls?: number;
  maxTurns?: number;
  metadata?: Record<string, unknown>;
  model: string;
  registry: ManifestRegistry;
  router: AicfCapabilityRouter;
  runtimeContext: AicfRuntimeContext;
  systemInstructions?: string;
  temperature?: number;
  traceSink?: AicfTraceSink;
  userInput: AicfRuntimeUserInput;
}

export interface AicfOpenAIRunResult {
  errors: Array<{
    code: string;
    message: string;
  }>;
  finalText: string;
  responseId?: string;
  runId: string;
  selectedCapabilities: CapabilitySlice;
  status: AicfOpenAIRunStatus;
  toolCalls: Array<{
    args: Record<string, unknown>;
    callId?: string;
    capabilityId: string;
    toolName: string;
  }>;
  toolResults: AicfRuntimeToolResultEnvelope[];
  traceEvents: AicfRuntimeTraceEvent[];
  usage?: Record<string, unknown>;
}

export interface CreateDefaultOpenAIResponsesClientOptions {
  apiKey?: string;
  organization?: string;
  project?: string;
  [key: string]: unknown;
}

export interface BuildOpenAIFunctionCallOutputOptions {
  includeDiagnosticsForModel?: boolean;
}

export interface AicfAgentsSdkToolDefinition {
  description: string;
  execute(input: unknown, context?: unknown, details?: unknown): Promise<string>;
  name: string;
  needsApproval?: boolean | ((context: unknown, input: unknown, callId?: string) => Promise<boolean> | boolean);
  parameters: Record<string, unknown>;
  strict: true;
}

export interface AicfAgentsSdkToolBridgeFactory {
  createFunctionTool(input: AicfAgentsSdkToolDefinition): unknown;
}

export interface CreateDefaultAgentsSdkBridgeFactoryOptions {
  moduleName?: string;
}

export interface AicfAgentsSdkBridgeOptions {
  builtContext: AicfBuiltContext;
  executor: AicfToolExecutor;
  factory?: AicfAgentsSdkToolBridgeFactory;
  maxCapabilities?: number;
  registry: ManifestRegistry;
  router: AicfCapabilityRouter;
  runtimeContext: AicfRuntimeContext;
  userInput?: AicfRuntimeUserInput;
}
