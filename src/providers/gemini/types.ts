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

export interface AicfGeminiFunctionDeclaration {
  description: string;
  name: string;
  parameters: JsonObject;
}

export interface AicfGeminiFunctionDeclarationSet {
  diagnostics: Array<{ code: string; message: string; path?: string; id?: string }>;
  functionDeclarations: AicfGeminiFunctionDeclaration[];
  toolNameMap: AicfProviderToolNameMap;
}

export interface BuildGeminiFunctionDeclarationsOptions {
  maxToolNameLength?: number;
  namePrefix?: string;
  registry: ManifestRegistry;
  slice?: RuntimeCapabilitySlice;
}

export interface AicfGeminiFunctionCallLike {
  args: unknown;
  id?: string;
  name: string;
}

export interface AicfGeminiGenerateContentResponseLike {
  candidates?: Array<Record<string, unknown>>;
  functionCalls?: AicfGeminiFunctionCallLike[];
  id?: string;
  responseId?: string;
  text?: string;
  usageMetadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AicfGeminiClient {
  models: {
    generateContent(input: Record<string, unknown>): Promise<AicfGeminiGenerateContentResponseLike>;
  };
}

export type AicfGeminiFunctionCallingMode = "AUTO" | "ANY" | "NONE" | "VALIDATED";

export type AicfGeminiRunStatus =
  | "completed"
  | "tool_limit_exceeded"
  | "turn_limit_exceeded"
  | "provider_error"
  | "failed";

export interface AicfGeminiRunRequest {
  allowedFunctionNames?: string[];
  builtContext: AicfBuiltContext;
  client: AicfGeminiClient;
  contentCapture?: AicfTraceContentCapture;
  contents: Array<Record<string, unknown>> | string;
  executor: AicfToolExecutor;
  functionCallingMode?: AicfGeminiFunctionCallingMode;
  maxToolCalls?: number;
  maxToolIterations?: number;
  model: string;
  registry: ManifestRegistry;
  runtimeContext: AicfRuntimeContext;
  slice: RuntimeCapabilitySlice;
  systemInstruction?: string;
  traceSink?: AicfTraceSink;
}

export interface AicfGeminiRunResult {
  errors: Array<{ code: string; message: string }>;
  finalText: string;
  iterations: number;
  provider: "gemini";
  responseId?: string;
  status: AicfGeminiRunStatus;
  toolCalls: AicfProviderToolCall[];
  toolResults: AicfRuntimeToolResultEnvelope[];
  traceEvents: AicfRuntimeTraceEvent[];
  usage?: Record<string, unknown>;
}

export interface ParseGeminiFunctionCallsResult {
  diagnostics: Array<{ code: string; message: string; path?: string }>;
  parsed: AicfProviderToolCall[];
  valid: boolean;
}

export interface AicfGeminiFunctionResponsePart {
  functionResponse: {
    id?: string;
    name: string;
    response: {
      result: AicfRuntimeToolResultEnvelope;
    };
  };
}

export interface CreateDefaultGeminiClientOptions {
  apiKey?: string;
  [key: string]: unknown;
}

export type AicfGeminiProviderToolResult = AicfProviderToolResult;
