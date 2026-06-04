import { emitTraceEvent, type AicfRuntimeTraceEvent } from "../../observability/index.js";
import { buildAiSdkTools } from "./tools.js";
import { safeAiSdkError } from "./errors.js";
import type {
  AicfAiSdkRunGenerateTextRequest,
  AicfAiSdkRunResult,
  AicfAiSdkToolCallSummary
} from "./types.js";

const defaultMaxSteps = 6;

export async function runAiSdkGenerateText(
  request: AicfAiSdkRunGenerateTextRequest
): Promise<AicfAiSdkRunResult> {
  const traceEvents: AicfRuntimeTraceEvent[] = [];
  const toolset = buildAiSdkTools(request);
  const emit = async (
    type: AicfRuntimeTraceEvent["type"],
    attributes?: Record<string, unknown>,
    message?: string
  ) => {
    await emitTraceEvent({
      attributes: {
        provider: "vercel-ai-sdk",
        ...attributes
      },
      contentCapture: request.contentCapture,
      events: traceEvents,
      message,
      requestId: request.runtimeContext.requestId,
      runId: request.runtimeContext.runId,
      sink: request.traceSink,
      timestamp: new Date(0).toISOString(),
      type
    });
  };

  await emit("runtime.start", {
    toolCount: Object.keys(toolset.tools).length
  });

  const stopWhen = request.stopWhen ?? request.toolFactories?.stepCountIs?.(request.maxSteps ?? defaultMaxSteps);
  const input = withoutUndefined({
    activeTools: request.activeTools,
    messages: request.messages,
    model: request.model,
    prompt: request.prompt,
    providerOptions: request.providerOptions,
    stopWhen,
    system: request.system,
    toolChoice: request.toolChoice,
    tools: toolset.tools
  });

  await emit("model.call.start", {
    hasMessages: Array.isArray(request.messages),
    hasPrompt: typeof request.prompt === "string",
    toolCount: Object.keys(toolset.tools).length
  });

  try {
    const result = await request.generateText(input);
    await emit("model.call.end", {
      finishReason: result.finishReason
    });
    await emit("runtime.end", {
      status: "completed"
    });

    return {
      errors: [],
      finishReason: result.finishReason,
      provider: "vercel-ai-sdk",
      status: "completed",
      steps: result.steps,
      text: typeof result.text === "string" ? result.text : undefined,
      toolCalls: summarizeToolCalls(result.toolCalls, toolset),
      toolResults: summarizeToolResults(result.toolResults),
      traceEvents,
      usage: result.totalUsage ?? result.usage,
      warnings: result.warnings
    };
  } catch (error) {
    const safeError = safeAiSdkError(error);
    await emit("runtime.error", {
      code: safeError.code
    });
    await emit("runtime.end", {
      status: "provider_error"
    });
    return {
      errors: [safeError],
      provider: "vercel-ai-sdk",
      status: "provider_error",
      toolCalls: [],
      toolResults: [],
      traceEvents
    };
  }
}

function summarizeToolCalls(value: unknown, toolset: ReturnType<typeof buildAiSdkTools>): AicfAiSdkToolCallSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((toolCall) => {
      const toolName = typeof toolCall.toolName === "string" ? toolCall.toolName : undefined;
      return {
        capabilityId: toolName ? toolset.toolNameMap.providerNameToCapabilityId(toolName) : undefined,
        toolCallId: typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : undefined,
        toolName
      };
    });
}

function summarizeToolResults(value: unknown): AicfAiSdkRunResult["toolResults"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((toolResult) => toolResult.result)
    .filter(isRuntimeEnvelope);
}

function isRuntimeEnvelope(value: unknown): value is AicfAiSdkRunResult["toolResults"][number] {
  return isRecord(value)
    && typeof value.capabilityId === "string"
    && typeof value.status === "string"
    && typeof value.runId === "string";
}

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
