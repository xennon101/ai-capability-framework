import { createToolEnvelope } from "../../runtime/index.js";
import type { AicfRuntimeToolResultEnvelope } from "../../runtime/index.js";
import { emitTraceEvent, type AicfRuntimeTraceEvent } from "../../observability/index.js";
import { executeProviderToolCall } from "../shared/run-loop.js";
import { buildProviderToolResult } from "../shared/tool-result.js";
import type { AicfProviderToolCall, AicfProviderToolResult } from "../shared/types.js";
import { safeGeminiError } from "./errors.js";
import {
  buildGeminiFunctionDeclarations,
  extractGeminiFunctionCalls,
  parseGeminiFunctionCalls
} from "./function-declarations.js";
import { buildGeminiFunctionResponseParts } from "./function-response.js";
import type {
  AicfGeminiFunctionCallLike,
  AicfGeminiGenerateContentResponseLike,
  AicfGeminiRunRequest,
  AicfGeminiRunResult,
  AicfGeminiRunStatus
} from "./types.js";

const defaultMaxToolIterations = 6;
const defaultMaxToolCalls = 10;

export async function runGeminiGenerateContent(
  request: AicfGeminiRunRequest
): Promise<AicfGeminiRunResult> {
  const traceEvents: AicfRuntimeTraceEvent[] = [];
  const contents: Array<Record<string, unknown>> = normalizeContents(request.contents);
  const maxToolIterations = request.maxToolIterations ?? defaultMaxToolIterations;
  const maxToolCalls = request.maxToolCalls ?? defaultMaxToolCalls;
  const declarationSet = buildGeminiFunctionDeclarations({
    registry: request.registry,
    slice: request.slice
  });
  const toolCalls: AicfProviderToolCall[] = [];
  const toolResults: AicfRuntimeToolResultEnvelope[] = [];
  let responseId: string | undefined;
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
        provider: "gemini",
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
    status: AicfGeminiRunStatus,
    input: {
      errors?: Array<{ code: string; message: string }>;
      finalText?: string;
    } = {}
  ): Promise<AicfGeminiRunResult> => {
    await emit("runtime.end", { status });
    return {
      errors: input.errors ?? [],
      finalText: input.finalText ?? "",
      iterations,
      provider: "gemini",
      responseId,
      status,
      toolCalls,
      toolResults,
      traceEvents,
      usage
    };
  };

  await emit("runtime.start", {
    model: request.model,
    toolCount: declarationSet.functionDeclarations.length
  });

  for (let turn = 0; turn < maxToolIterations; turn += 1) {
    iterations = turn + 1;
    const providerControl = request.controls?.evaluate({
      model: request.model,
      operation: "provider_call",
      providerId: "gemini",
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

    const createInput = geminiGenerateContentInput({
      contents,
      functionDeclarations: declarationSet.functionDeclarations,
      request
    });

    await emit("model.call.start", {
      model: request.model,
      turn
    });

    let response: AicfGeminiGenerateContentResponseLike;
    try {
      response = await request.client.models.generateContent(createInput);
    } catch (error) {
      const safeError = safeGeminiError(error);
      await emit("runtime.error", { code: safeError.code });
      return finish("provider_error", {
        errors: [safeError]
      });
    }

    responseId = response.responseId ?? response.id ?? responseId;
    usage = response.usageMetadata ?? usage;
    await emit("model.call.end", {
      model: request.model,
      responseId,
      turn
    });

    const functionCalls = extractGeminiFunctionCalls(response);
    if (functionCalls.length === 0) {
      return finish("completed", {
        finalText: extractGeminiText(response)
      });
    }

    if (toolCallCount + functionCalls.length > maxToolCalls) {
      await emit("runtime.error", {
        maxToolCalls,
        requestedToolCalls: toolCallCount + functionCalls.length
      });
      return finish("tool_limit_exceeded", {
        errors: [{
          code: "provider_loop_max_tool_calls",
          message: "The Gemini runtime reached the configured tool call limit."
        }]
      });
    }

    const toolBudgetControl = request.controls?.evaluate({
      model: request.model,
      operation: "provider_call",
      providerId: "gemini",
      registry: request.registry,
      runtimeContext: request.runtimeContext,
      usage: {
        providerCalls: turn + 1,
        retries: 0,
        runtimeMs: Date.now() - startedAt,
        toolCalls: toolCallCount + functionCalls.length
      }
    });
    if (toolBudgetControl?.status === "denied") {
      await emit("runtime.error", { code: "budget_exceeded" });
      return finish("budget_exceeded", {
        errors: controlErrors(toolBudgetControl)
      });
    }

    const providerResults: AicfProviderToolResult[] = [];
    for (const call of functionCalls) {
      toolCallCount += 1;
      const parsed = parseGeminiFunctionCalls(declarationSet, [call]);
      const providerCall = parsed.parsed[0] ?? fallbackProviderCall(call);
      if (parsed.parsed[0]) {
        toolCalls.push(parsed.parsed[0]);
      }

      await emit("tool.call.parsed", {
        capabilityId: parsed.parsed[0]?.capabilityId,
        providerToolCallId: call.id,
        providerToolName: call.name
      });
      await emit("tool.execution.start", {
        providerToolCallId: call.id,
        providerToolName: call.name
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
            toolNameMap: declarationSet.toolNameMap
          })
        : buildInvalidFunctionCallResult({
            diagnostics: parsed.diagnostics,
            providerCall,
            request
          });

      providerResults.push(result);
      toolResults.push(result.envelope);
      await emit("tool.execution.end", {
        capabilityId: result.capabilityId,
        providerToolCallId: call.id,
        providerToolName: call.name,
        status: result.envelope.status
      });
    }

    contents.push(geminiModelFunctionCallContent(functionCalls));
    contents.push({
      parts: buildGeminiFunctionResponseParts(providerResults),
      role: "user"
    });
  }

  await emit("runtime.error", {
    maxToolIterations
  });
  return finish("turn_limit_exceeded", {
    errors: [{
      code: "provider_loop_max_iterations",
      message: "The Gemini runtime reached the configured tool iteration limit."
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

function geminiGenerateContentInput(input: {
  contents: Array<Record<string, unknown>>;
  functionDeclarations: unknown[];
  request: AicfGeminiRunRequest;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (input.functionDeclarations.length > 0) {
    config.tools = [{
      functionDeclarations: input.functionDeclarations
    }];
  }
  if (hasText(input.request.systemInstruction)) {
    config.systemInstruction = input.request.systemInstruction;
  }
  if (input.request.functionCallingMode || input.request.allowedFunctionNames) {
    config.toolConfig = {
      functionCallingConfig: {
        ...(input.request.functionCallingMode ? { mode: input.request.functionCallingMode } : {}),
        ...(input.request.allowedFunctionNames ? { allowedFunctionNames: input.request.allowedFunctionNames } : {})
      }
    };
  }

  return {
    config,
    contents: input.contents,
    model: input.request.model
  };
}

function normalizeContents(contents: Array<Record<string, unknown>> | string): Array<Record<string, unknown>> {
  if (typeof contents === "string") {
    return [{
      parts: [{ text: contents }],
      role: "user"
    }];
  }
  return contents.map((content) => ({ ...content }));
}

function geminiModelFunctionCallContent(calls: AicfGeminiFunctionCallLike[]): Record<string, unknown> {
  return {
    parts: calls.map((call) => ({
      functionCall: {
        ...(call.id ? { id: call.id } : {}),
        args: call.args,
        name: call.name
      }
    })),
    role: "model"
  };
}

function extractGeminiText(response: AicfGeminiGenerateContentResponseLike): string {
  if (typeof response.text === "string") {
    return response.text;
  }

  const parts = [];
  for (const candidate of Array.isArray(response.candidates) ? response.candidates : []) {
    const content = isRecord(candidate.content) ? candidate.content : undefined;
    for (const part of Array.isArray(content?.parts) ? content.parts : []) {
      if (isRecord(part) && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}

function buildInvalidFunctionCallResult(input: {
  diagnostics: Array<{ code: string; message: string; path?: string }>;
  providerCall: AicfProviderToolCall;
  request: AicfGeminiRunRequest;
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
      userMessage: "The Gemini function input was invalid."
    }),
    providerCall: input.providerCall,
    runtimeContext: input.request.runtimeContext
  });
}

function fallbackProviderCall(call: AicfGeminiFunctionCallLike): AicfProviderToolCall {
  return {
    args: isRecord(call.args) ? { ...call.args } : {},
    callId: call.id,
    capabilityId: "unknown",
    provider: "gemini",
    providerToolName: hasText(call.name) ? call.name : "unknown",
    rawProviderRef: {
      id: call.id,
      type: "functionCall"
    }
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
