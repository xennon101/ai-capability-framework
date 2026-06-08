import { createToolEnvelope } from "../../runtime/index.js";
import type { AicfRuntimeToolResultEnvelope } from "../../runtime/index.js";
import { emitTraceEvent, type AicfRuntimeTraceEvent } from "../../observability/index.js";
import { executeProviderToolCall } from "../shared/run-loop.js";
import { buildProviderToolResult } from "../shared/tool-result.js";
import type { AicfProviderToolCall, AicfProviderToolResult } from "../shared/types.js";
import { safeAnthropicError } from "./errors.js";
import { buildAnthropicToolResultMessage } from "./tool-result.js";
import {
  buildAnthropicTools,
  extractAnthropicToolUseBlocks,
  parseAnthropicToolUseBlocks
} from "./tools.js";
import type {
  AicfAnthropicMessage,
  AicfAnthropicMessageResponseLike,
  AicfAnthropicRunRequest,
  AicfAnthropicRunResult,
  AicfAnthropicRunStatus,
  AicfAnthropicToolUseBlock
} from "./types.js";

const defaultMaxToolIterations = 6;
const defaultMaxToolCalls = 10;
const defaultMaxTokens = 1024;

export async function runAnthropicMessages(
  request: AicfAnthropicRunRequest
): Promise<AicfAnthropicRunResult> {
  const traceEvents: AicfRuntimeTraceEvent[] = [];
  const messages: AicfAnthropicMessage[] = [...request.messages];
  const maxToolIterations = request.maxToolIterations ?? defaultMaxToolIterations;
  const maxToolCalls = request.maxToolCalls ?? defaultMaxToolCalls;
  const toolset = buildAnthropicTools({
    registry: request.registry,
    slice: request.slice,
    strictTools: request.strictTools
  });
  const toolCalls: AicfProviderToolCall[] = [];
  const toolResults: AicfRuntimeToolResultEnvelope[] = [];
  let responseId: string | undefined;
  let stopReason: string | null | undefined;
  let usage: Record<string, unknown> | undefined;
  let toolCallCount = 0;
  let iterations = 0;
  const startedAt = Date.now();

  const emit = async (
    type: AicfRuntimeTraceEvent["type"],
    attributes?: Record<string, unknown>,
    message?: string
  ) => {
    await emitTraceEvent({
      attributes: {
        provider: "anthropic",
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

  const finish = async (
    status: AicfAnthropicRunStatus,
    input: {
      errors?: Array<{ code: string; message: string }>;
      finalText?: string;
    } = {}
  ): Promise<AicfAnthropicRunResult> => {
    await emit("runtime.end", { status });
    return {
      errors: input.errors ?? [],
      finalText: input.finalText ?? "",
      iterations,
      provider: "anthropic",
      responseId,
      status,
      stopReason,
      toolCalls,
      toolResults,
      traceEvents,
      usage
    };
  };

  await emit("runtime.start", {
    model: request.model,
    toolCount: toolset.tools.length
  });

  for (let turn = 0; turn < maxToolIterations; turn += 1) {
    iterations = turn + 1;
    const providerControl = request.controls?.evaluate({
      model: request.model,
      operation: "provider_call",
      providerId: "anthropic",
      registry: request.registry,
      runtimeContext: request.runtimeContext,
      usage: {
        providerCalls: turn + 1,
        retries: 0,
        runtimeMs: Date.now() - startedAt,
        toolCalls: toolCallCount
      }
    });
    if (providerControl?.status === "denied") {
      await emit("runtime.error", { code: providerControl.budgetDecision?.status === "denied" ? "budget_exceeded" : "control_denied" });
      return finish(providerControl.budgetDecision?.status === "denied" ? "budget_exceeded" : "control_denied", {
        errors: controlErrors(providerControl)
      });
    }

    const createInput = anthropicCreateInput({
      messages,
      request,
      tools: toolset.tools
    });

    await emit("model.call.start", {
      model: request.model,
      turn
    });

    let response: AicfAnthropicMessageResponseLike;
    try {
      response = await request.client.messages.create(createInput);
    } catch (error) {
      const safeError = safeAnthropicError(error);
      await emit("runtime.error", { code: safeError.code });
      return finish("provider_error", {
        errors: [safeError]
      });
    }

    responseId = response.id ?? responseId;
    stopReason = response.stop_reason;
    usage = response.usage ?? usage;
    await emit("model.call.end", {
      model: request.model,
      responseId,
      turn
    });

    const toolUseBlocks = extractAnthropicToolUseBlocks(response);
    if (toolUseBlocks.length === 0) {
      return finish("completed", {
        finalText: extractAnthropicText(response)
      });
    }

    if (toolCallCount + toolUseBlocks.length > maxToolCalls) {
      await emit("runtime.error", {
        maxToolCalls,
        requestedToolCalls: toolCallCount + toolUseBlocks.length
      });
      return finish("tool_limit_exceeded", {
        errors: [{
          code: "provider_loop_max_tool_calls",
          message: "The Anthropic runtime reached the configured tool call limit."
        }]
      });
    }

    const toolBudgetControl = request.controls?.evaluate({
      model: request.model,
      operation: "provider_call",
      providerId: "anthropic",
      registry: request.registry,
      runtimeContext: request.runtimeContext,
      usage: {
        providerCalls: turn + 1,
        retries: 0,
        runtimeMs: Date.now() - startedAt,
        toolCalls: toolCallCount + toolUseBlocks.length
      }
    });
    if (toolBudgetControl?.status === "denied") {
      await emit("runtime.error", { code: "budget_exceeded" });
      return finish("budget_exceeded", {
        errors: controlErrors(toolBudgetControl)
      });
    }

    const providerResults: AicfProviderToolResult[] = [];
    for (const block of toolUseBlocks) {
      if (!hasText(block.id)) {
        await emit("runtime.error", {
          toolName: block.name
        }, "Anthropic tool_use block was missing id.");
        return finish("failed", {
          errors: [{
            code: "provider_tool_call_id_missing",
            message: "Anthropic tool_use block was missing id."
          }]
        });
      }

      toolCallCount += 1;
      const parsed = parseAnthropicToolUseBlocks(toolset, [block]);
      const providerCall = parsed.parsed[0] ?? fallbackProviderCall(block);
      if (parsed.parsed[0]) {
        toolCalls.push(parsed.parsed[0]);
      }

      await emit("tool.call.parsed", {
        capabilityId: parsed.parsed[0]?.capabilityId,
        providerToolCallId: block.id,
        providerToolName: block.name
      });
      await emit("tool.execution.start", {
        providerToolCallId: block.id,
        providerToolName: block.name
      });

      const result = parsed.valid
        ? await executeProviderToolCall({
            builtContext: request.builtContext,
            controls: request.controls,
            executor: request.executor,
            providerCall,
            registry: request.registry,
            runtimeContext: request.runtimeContext,
            runtimeSlice: request.slice,
            toolNameMap: toolset.toolNameMap
          })
        : buildInvalidToolUseResult({
            block,
            diagnostics: parsed.diagnostics,
            providerCall,
            request
          });

      providerResults.push(result);
      toolResults.push(result.envelope);
      await emit("tool.execution.end", {
        capabilityId: result.capabilityId,
        providerToolCallId: block.id,
        providerToolName: block.name,
        status: result.envelope.status
      });
    }

    messages.push({
      content: response.content,
      role: "assistant"
    });
    messages.push(buildAnthropicToolResultMessage(providerResults));
  }

  await emit("runtime.error", {
    maxToolIterations
  });
  return finish("turn_limit_exceeded", {
    errors: [{
      code: "provider_loop_max_iterations",
      message: "The Anthropic runtime reached the configured tool iteration limit."
    }]
  });
}

function controlErrors(decision: {
  reasons: Array<{ code: string; message: string }>;
}): Array<{ code: string; message: string }> {
  return decision.reasons.length > 0
    ? decision.reasons.map((reason) => ({ code: reason.code, message: reason.message }))
    : [{ code: "control_denied", message: "The runtime controls denied this operation." }];
}

function anthropicCreateInput(input: {
  messages: AicfAnthropicMessage[];
  request: AicfAnthropicRunRequest;
  tools: unknown[];
}): Record<string, unknown> {
  const createInput: Record<string, unknown> = {
    max_tokens: input.request.maxTokens ?? defaultMaxTokens,
    messages: input.messages,
    model: input.request.model
  };
  if (hasText(input.request.system)) {
    createInput.system = input.request.system;
  }
  if (input.tools.length > 0) {
    createInput.tools = input.tools;
  }
  if (input.request.toolChoice) {
    createInput.tool_choice = typeof input.request.toolChoice === "string"
      ? { type: input.request.toolChoice }
      : input.request.toolChoice;
  }
  return createInput;
}

function extractAnthropicText(response: AicfAnthropicMessageResponseLike): string {
  return response.content
    .filter((block): block is { text: string; type: "text" } => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function buildInvalidToolUseResult(input: {
  block: AicfAnthropicToolUseBlock;
  diagnostics: Array<{ code: string; message: string; path?: string }>;
  providerCall: AicfProviderToolCall;
  request: AicfAnthropicRunRequest;
}): AicfProviderToolResult {
  return buildProviderToolResult({
    envelope: createToolEnvelope({
      capabilityId: input.providerCall.capabilityId,
      errors: input.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.path
      })),
      operation: "read",
      requestId: input.request.runtimeContext.requestId,
      runId: input.request.runtimeContext.runId,
      status: "validation_error",
      userMessage: "The Anthropic tool input was invalid."
    }),
    providerCall: input.providerCall,
    runtimeContext: input.request.runtimeContext
  });
}

function fallbackProviderCall(block: AicfAnthropicToolUseBlock): AicfProviderToolCall {
  return {
    args: isRecord(block.input) ? { ...block.input } : {},
    callId: block.id,
    capabilityId: "unknown",
    provider: "anthropic",
    providerToolName: hasText(block.name) ? block.name : "unknown",
    rawProviderRef: {
      id: block.id,
      type: "tool_use"
    }
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
