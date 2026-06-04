import type {
  AicfBuiltContext,
  AicfRuntimeContext,
  AicfRuntimeToolResultEnvelope,
  AicfToolExecutor,
  RuntimeCapabilitySlice
} from "../../runtime/index.js";
import type { AicfRuntimeTraceEvent, AicfTraceContentCapture, AicfTraceSink } from "../../observability/index.js";
import type { AicfDiagnostic, JsonObject, ManifestRegistry } from "../../types.js";
import type { AicfProviderToolNameMap } from "../shared/types.js";

export interface AicfAiSdkToolFactories {
  jsonSchema(schema: JsonObject, options?: {
    validate?: (value: unknown) => PromiseLike<AicfAiSdkSchemaValidationResult> | AicfAiSdkSchemaValidationResult;
  }): unknown;
  stepCountIs?(count: number): unknown;
  tool(config: AicfAiSdkToolConfig): unknown;
}

export interface AicfAiSdkToolConfig {
  description: string;
  execute(args: unknown, executionContext?: Record<string, unknown>): Promise<AicfRuntimeToolResultEnvelope>;
  inputSchema: unknown;
  needsApproval?: boolean;
  strict?: boolean;
}

export interface AicfAiSdkSchemaValidationResult {
  error?: Error;
  success: boolean;
  value?: unknown;
}

export interface BuildAiSdkToolsRequest {
  builtContext: AicfBuiltContext;
  contentCapture?: AicfTraceContentCapture;
  executor: AicfToolExecutor;
  includeApprovalMetadata?: boolean;
  maxToolNameLength?: number;
  namePrefix?: string;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
  slice: RuntimeCapabilitySlice;
  strict?: boolean;
  toolFactories?: AicfAiSdkToolFactories;
  traceSink?: AicfTraceSink;
}

export interface AicfAiSdkToolSet {
  diagnostics: AicfDiagnostic[];
  toolNameMap: AicfProviderToolNameMap;
  tools: Record<string, unknown>;
}

export type AicfAiSdkToolset = AicfAiSdkToolSet;

export interface AicfAiSdkGenerateTextLike {
  (input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AicfAiSdkStreamTextLike {
  (input: Record<string, unknown>): unknown;
}

export interface AicfAiSdkRunGenerateTextRequest extends BuildAiSdkToolsRequest {
  activeTools?: string[];
  generateText: AicfAiSdkGenerateTextLike;
  maxSteps?: number;
  messages?: unknown[];
  model: unknown;
  prompt?: string;
  providerOptions?: Record<string, unknown>;
  stopWhen?: unknown;
  system?: string;
  toolChoice?: unknown;
}

export interface AicfAiSdkRunStreamTextRequest extends BuildAiSdkToolsRequest {
  activeTools?: string[];
  maxSteps?: number;
  messages?: unknown[];
  model: unknown;
  prompt?: string;
  providerOptions?: Record<string, unknown>;
  stopWhen?: unknown;
  streamText: AicfAiSdkStreamTextLike;
  system?: string;
  toolChoice?: unknown;
}

export type AicfAiSdkRunStatus = "completed" | "provider_error";

export interface AicfAiSdkToolCallSummary {
  capabilityId?: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AicfAiSdkRunResult {
  errors: Array<{ code: string; message: string }>;
  finishReason?: unknown;
  provider: "vercel-ai-sdk";
  status: AicfAiSdkRunStatus;
  steps?: unknown;
  text?: string;
  toolCalls: AicfAiSdkToolCallSummary[];
  toolResults: AicfRuntimeToolResultEnvelope[];
  traceEvents: AicfRuntimeTraceEvent[];
  usage?: unknown;
  warnings?: unknown;
}

export interface AicfAiSdkStreamRunResult {
  errors: Array<{ code: string; message: string }>;
  provider: "vercel-ai-sdk";
  status: AicfAiSdkRunStatus;
  streamResult?: unknown;
  traceEvents: AicfRuntimeTraceEvent[];
}
