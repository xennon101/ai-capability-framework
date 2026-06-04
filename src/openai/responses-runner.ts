import {
  parseOpenAIResponsesToolCall,
  type OpenAIResponsesFunctionCall
} from "../index.js";
import {
  createToolEnvelope,
  formatCapabilitySliceForModel,
  type AicfBuiltContext,
  type AicfRuntimeToolResultEnvelope,
  type CapabilitySlice as RuntimeCapabilitySlice
} from "../runtime/index.js";
import { emitTraceEvent, type AicfRuntimeTraceEvent } from "../observability/index.js";
import { safeOpenAIError } from "./errors.js";
import {
  buildOpenAIFunctionCallOutput,
  extractOpenAIResponsesFunctionCalls
} from "./tool-output.js";
import {
  buildRuntimeOpenAIToolset,
  defaultOpenAISafetyInstructions,
  extractOpenAIResponseText,
  formatOpenAIInitialInput
} from "./tool-loop.js";
import type {
  AicfOpenAIResponseLike,
  AicfOpenAIRunRequest,
  AicfOpenAIRunResult,
  AicfOpenAIRunStatus
} from "./types.js";

const defaultMaxTurns = 6;
const defaultMaxToolCalls = 10;

export async function runOpenAIResponses(
  request: AicfOpenAIRunRequest
): Promise<AicfOpenAIRunResult> {
  const runId = request.runtimeContext.runId;
  const requestId = request.runtimeContext.requestId;
  const traceEvents: AicfRuntimeTraceEvent[] = [];
  const toolCalls: AicfOpenAIRunResult["toolCalls"] = [];
  const toolResults: AicfRuntimeToolResultEnvelope[] = [];
  const maxTurns = request.maxTurns ?? defaultMaxTurns;
  const maxToolCalls = request.maxToolCalls ?? defaultMaxToolCalls;
  let selectedCapabilities: RuntimeCapabilitySlice = {
    excluded: [],
    items: [],
    warnings: []
  };
  let responseId: string | undefined;
  let usage: Record<string, unknown> | undefined;
  let toolCallCount = 0;

  const emit = async (
    type: AicfRuntimeTraceEvent["type"],
    attributes?: Record<string, unknown>,
    message?: string
  ) => {
    await emitTraceEvent({
      attributes,
      contentCapture: request.contentCapture,
      events: traceEvents,
      message,
      requestId,
      runId,
      sink: request.traceSink,
      timestamp: new Date(0).toISOString(),
      type
    });
  };

  const finish = async (
    status: AicfOpenAIRunStatus,
    input: {
      errors?: Array<{ code: string; message: string }>;
      finalText?: string;
    } = {}
  ): Promise<AicfOpenAIRunResult> => {
    await emit("runtime.end", { status });
    return {
      errors: input.errors ?? [],
      finalText: input.finalText ?? "",
      responseId,
      runId,
      selectedCapabilities,
      status,
      toolCalls,
      toolResults,
      traceEvents,
      usage
    };
  };

  await emit("runtime.start", {
    model: request.model
  });

  let builtContext: AicfBuiltContext;
  try {
    await emit("context.build.start", {
      itemCount: 0
    });
    builtContext = await request.contextBuilder.build({
      baseContext: request.runtimeContext,
      registry: request.registry,
      userInput: request.userInput
    });
  } catch (error) {
    await emit("runtime.error", { code: "runtime_context_invalid" });
    return finish("failed", {
      errors: [{
        code: "runtime_context_invalid",
        message: error instanceof Error ? firstLine(error.message) : "Runtime context could not be built."
      }]
    });
  }

  await emit("context.build.end", {
    itemCount: builtContext.items.length,
    warningCount: builtContext.warnings.length
  });

  await emit("capability.route.start", {
    capabilityCount: request.registry.capabilities.length
  });
  selectedCapabilities = await request.router.route({
    builtContext,
    includeRestricted: false,
    registry: request.registry,
    userInput: request.userInput
  });
  await emit("capability.route.end", {
    capabilityIds: selectedCapabilities.items.map((item) => item.capabilityId),
    excludedCount: selectedCapabilities.excluded.length
  });

  const toolset = buildRuntimeOpenAIToolset({
    builtContext,
    registry: request.registry,
    runtimeContext: request.runtimeContext,
    runtimeSlice: selectedCapabilities
  });
  const capabilitySliceText = formatCapabilitySliceForModel({
    registry: request.registry,
    slice: selectedCapabilities
  });
  const instructions = [
    defaultOpenAISafetyInstructions,
    request.systemInstructions
  ].filter(Boolean).join("\n\n");
  let modelInput: unknown = formatOpenAIInitialInput({
    builtContext,
    capabilitySliceText,
    userInput: request.userInput
  });

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const responseRequest = openAIResponseRequest({
      input: modelInput,
      instructions,
      metadata: request.metadata,
      model: request.model,
      previousResponseId: responseId,
      temperature: request.temperature,
      tools: toolset.tools
    });
    await emit("model.call.start", {
      model: request.model,
      toolCount: toolset.tools.length,
      turn
    });

    let response: AicfOpenAIResponseLike;
    try {
      response = await request.client.responses.create(responseRequest);
    } catch (error) {
      const safeError = safeOpenAIError(error);
      await emit("runtime.error", { code: safeError.code });
      return finish("provider_error", {
        errors: [safeError]
      });
    }

    responseId = response.id ?? responseId;
    usage = response.usage ?? usage;
    await emit("model.call.end", {
      model: request.model,
      responseId,
      turn
    });

    const calls = extractOpenAIResponsesFunctionCalls(response);
    if (calls.length === 0) {
      return finish("completed", {
        finalText: extractOpenAIResponseText(response)
      });
    }

    if (toolCallCount + calls.length > maxToolCalls) {
      await emit("runtime.error", {
        maxToolCalls,
        requestedToolCalls: toolCallCount + calls.length
      });
      return finish("tool_limit_exceeded", {
        errors: [{
          code: "tool_limit_exceeded",
          message: "The OpenAI runtime reached the configured tool call limit."
        }]
      });
    }

    const toolOutputs = [];
    for (const call of calls) {
      if (!hasText(call.call_id)) {
        await emit("runtime.error", {
          toolName: call.name
        }, "OpenAI function call was missing call_id.");
        return finish("failed", {
          errors: [{
            code: "invalid_tool_call",
            message: "OpenAI function call was missing call_id."
          }]
        });
      }

      toolCallCount += 1;
      const parsedForTrace = parseOpenAIResponsesToolCall(toolset, call);
      if (parsedForTrace.valid && parsedForTrace.parsed) {
        toolCalls.push({
          args: parsedForTrace.parsed.args,
          callId: parsedForTrace.parsed.callId,
          capabilityId: parsedForTrace.parsed.capabilityId,
          toolName: parsedForTrace.parsed.toolName
        });
      }
      await emit("tool.call.parsed", {
        capabilityId: parsedForTrace.parsed?.capabilityId,
        callId: call.call_id,
        toolName: call.name
      });
      await emit("tool.execution.start", {
        callId: call.call_id,
        toolName: call.name
      });
      const envelope = await executeToolCall({
        builtContext,
        call,
        request,
        toolset
      });
      toolResults.push(envelope);
      await emit("tool.execution.end", {
        capabilityId: envelope.capabilityId,
        status: envelope.status,
        toolName: call.name
      });
      toolOutputs.push(buildOpenAIFunctionCallOutput(call, envelope));
    }

    modelInput = toolOutputs;
  }

  await emit("runtime.error", { maxTurns });
  return finish("turn_limit_exceeded", {
    errors: [{
      code: "turn_limit_exceeded",
      message: "The OpenAI runtime reached the configured turn limit."
    }]
  });
}

async function executeToolCall(input: {
  builtContext: AicfBuiltContext;
  call: OpenAIResponsesFunctionCall;
  request: AicfOpenAIRunRequest;
  toolset: ReturnType<typeof buildRuntimeOpenAIToolset>;
}): Promise<AicfRuntimeToolResultEnvelope> {
  const parsed = parseOpenAIResponsesToolCall(input.toolset, input.call);
  if (!parsed.valid || !parsed.parsed) {
    return invalidToolCallEnvelope({
      call: input.call,
      diagnostics: parsed.diagnostics,
      request: input.request
    });
  }

  const capability = input.request.registry.capabilityById.get(parsed.parsed.capabilityId);
  if (!capability) {
    return createToolEnvelope({
      capabilityId: parsed.parsed.capabilityId,
      errors: [{
        code: "capability_not_found",
        message: "The requested capability was not found."
      }],
      operation: "read",
      requestId: input.request.runtimeContext.requestId,
      runId: input.request.runtimeContext.runId,
      status: "unavailable",
      userMessage: "The capability is unavailable."
    });
  }

  const operation = capability.manifest.lifecycle.prepare ? "prepare" : "read";
  return input.request.executor.execute({
    args: parsed.parsed.args,
    builtContext: input.builtContext,
    capabilityId: parsed.parsed.capabilityId,
    operation,
    runtimeContext: input.request.runtimeContext,
    source: "model_tool_call"
  });
}

function invalidToolCallEnvelope(input: {
  call: OpenAIResponsesFunctionCall;
  diagnostics: Array<{ code: string; id?: string; message: string; path?: string }>;
  request: AicfOpenAIRunRequest;
}): AicfRuntimeToolResultEnvelope {
  const unknownTool = input.diagnostics.some((diagnostic) => diagnostic.message.includes("Unknown tool name"));
  return createToolEnvelope({
    capabilityId: unknownTool ? "unknown" : input.diagnostics[0]?.id ?? input.call.name,
    errors: input.diagnostics.map((diagnostic) => ({
      code: String(diagnostic.code),
      message: diagnostic.message,
      path: diagnostic.path
    })),
    operation: "read",
    requestId: input.request.runtimeContext.requestId,
    runId: input.request.runtimeContext.runId,
    status: unknownTool ? "unavailable" : "validation_error",
    userMessage: unknownTool ? "The requested tool is unavailable." : "The tool input was invalid."
  });
}

function openAIResponseRequest(input: {
  input: unknown;
  instructions: string;
  metadata?: Record<string, unknown>;
  model: string;
  previousResponseId?: string;
  temperature?: number;
  tools: unknown[];
}): Record<string, unknown> {
  return removeUndefined({
    input: input.input,
    instructions: input.instructions,
    metadata: input.metadata,
    model: input.model,
    parallel_tool_calls: false,
    previous_response_id: input.previousResponseId,
    stream: false,
    temperature: input.temperature,
    tools: input.tools
  });
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? "";
}
