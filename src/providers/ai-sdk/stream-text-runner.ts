import { emitTraceEvent, type AicfRuntimeTraceEvent } from "../../observability/index.js";
import { buildAiSdkTools } from "./tools.js";
import { safeAiSdkError } from "./errors.js";
import type {
  AicfAiSdkRunStreamTextRequest,
  AicfAiSdkStreamRunResult
} from "./types.js";

const defaultMaxSteps = 6;

export async function runAiSdkStreamText(
  request: AicfAiSdkRunStreamTextRequest
): Promise<AicfAiSdkStreamRunResult> {
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
    stream: true,
    toolCount: Object.keys(toolset.tools).length
  });

  const stopWhen = request.stopWhen ?? request.toolFactories?.stepCountIs?.(request.maxSteps ?? defaultMaxSteps);
  const input = withoutUndefined({
    activeTools: request.activeTools,
    includeRawChunks: false,
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
    stream: true,
    toolCount: Object.keys(toolset.tools).length
  });

  try {
    const streamResult = request.streamText(input);
    await emit("model.call.end", {
      stream: true
    });
    await emit("runtime.end", {
      status: "completed"
    });
    return {
      errors: [],
      provider: "vercel-ai-sdk",
      status: "completed",
      streamResult,
      traceEvents
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
      traceEvents
    };
  }
}

function withoutUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
