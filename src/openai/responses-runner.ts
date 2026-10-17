import { isDeepStrictEqual } from "node:util";
import { assertProviderRunScope } from "../runtime/provider-run.js";
import { aggregateProviderUsage, freezeProviderValue } from "../runtime/provider-usage.js";
import type { ProviderStageUsage } from "../runtime/provider-types.js";
import type { CapabilityRouteRequest } from "../runtime/types.js";
import { stopReason } from "../runtime/provider-stop.js";
import { enforceOpenAIInputTokens, normalizeOpenAIUsage } from "./selection-client.js";
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
import { controlDecisionToPolicyReasons } from "../controls/index.js";
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
  input: AicfOpenAIRunRequest
): Promise<AicfOpenAIRunResult> {
  const request = Object.freeze({ ...input });
  const sourceExecution = request.providerExecution;
  const providerExecution = sourceExecution ? Object.freeze({ ...sourceExecution, configuration: Object.freeze({ ...sourceExecution.configuration }) }) : undefined;
  const clientCreate = request.client.responses.create;
  const executionCurrent = () => !sourceExecution || !!providerExecution
    && isDeepStrictEqual(sourceExecution.configuration, providerExecution.configuration)
    && sourceExecution.mock === providerExecution.mock && sourceExecution.maxInputTokens === providerExecution.maxInputTokens
    && sourceExecution.maxOutputTokens === providerExecution.maxOutputTokens
    && sourceExecution.inputTokenPreflight === providerExecution.inputTokenPreflight
    && sourceExecution.maxEstimatedCostPerCall === providerExecution.maxEstimatedCostPerCall
    && sourceExecution.estimateCost === providerExecution.estimateCost;
  const runId = request.runtimeContext.runId;
  const providerRun = request.providerRun ?? request.router.providerRun;
  if (providerRun) {
    assertProviderRunScope(providerRun, runId);
    if (request.providerRun && request.router.providerRun && request.providerRun !== request.router.providerRun)
      throw new Error("The router and runner provider scopes conflict.");
    if (!request.providerExecution || request.providerExecution.configuration.model !== request.model
      || typeof request.providerExecution.inputTokenPreflight !== "function" || typeof request.providerExecution.mock !== "boolean"
      || !Number.isSafeInteger(request.providerExecution.maxInputTokens) || request.providerExecution.maxInputTokens < 1
      || !Number.isSafeInteger(request.providerExecution.maxOutputTokens) || request.providerExecution.maxOutputTokens < 1
      || providerRun.budget.policy.maxEstimatedCostPerRun !== undefined && request.providerExecution.maxEstimatedCostPerCall === undefined) throw new Error("Managed model turns require explicit token limits, provenance and a token preflight.");
  }
  const runtimeSignals = [request.signal, providerRun?.signal].filter((item): item is AbortSignal => !!item);
  const runtimeSignal = runtimeSignals.length ? AbortSignal.any(runtimeSignals) : undefined;
  const managedStages: ProviderStageUsage[] = [];
  const history: Array<{ request: Readonly<Record<string, unknown>>; response: AicfOpenAIResponseLike }> = [];
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
  const startedAt = Date.now();

  const emit = async (
    type: AicfRuntimeTraceEvent["type"],
    attributes?: Record<string, unknown>,
    message?: string
  ) => {
    await emitTraceEvent({
      attributes: {
        provider: "openai",
        ...attributes
      },
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
    if (providerRun) {
      const totals = providerRun.snapshot().usage.totals;
      providerRun.record("usage.summary", requestId, { outcome: status, providerAttempts: totals.providerAttempts,
        completedResponses: totals.completedResponses, inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
        totalTokens: totals.totalTokens, cachedInputTokens: totals.cachedInputTokens, reasoningTokens: totals.reasoningTokens,
        estimatedCost: totals.estimatedCost, elapsedMs: totals.elapsedMs });
    }
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
      usage, ...(providerRun ? { providerUsage: aggregateProviderUsage(managedStages, Date.now() - startedAt) } : {})
    };
  };

  await emit("runtime.start", {
    model: request.model
  });

  const startupControl = request.controls?.evaluate({
    model: request.model,
    operation: "provider_call",
    providerId: "openai",
    registry: request.registry,
    runtimeContext: request.runtimeContext,
    usage: {
      providerCalls: 0,
      retries: 0,
      runtimeMs: Date.now() - startedAt,
      toolCalls: 0
    }
  });
  if (startupControl?.status === "denied") {
    await emit("runtime.error", { code: "control_denied" });
    return finish("control_denied", {
      errors: controlErrors(startupControl)
    });
  }

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
  const routeRequest: CapabilityRouteRequest = {
    builtContext,
    controls: request.controls,
    includeRestricted: false,
    registry: request.registry,
    userInput: request.userInput, providerRun, signal: runtimeSignal,
    ...(Number.isFinite(Math.min(request.deadlineAt ?? Infinity, providerRun?.deadlineAt ?? Infinity))
      ? { deadlineAt: Math.min(request.deadlineAt ?? Infinity, providerRun?.deadlineAt ?? Infinity) } : {})
  };
  selectedCapabilities = await request.router.route(routeRequest);
  if (request.router.revalidate) selectedCapabilities = await request.router.revalidate(routeRequest, selectedCapabilities);
  await emit("capability.route.end", {
    capabilityIds: selectedCapabilities.items.map((item) => item.capabilityId),
    excludedCount: selectedCapabilities.excluded.length
  });

  let toolset = buildRuntimeOpenAIToolset({
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

  const revalidate = async () => {
    const stopped = stopReason({ signal: runtimeSignal,
      deadlineAt: Math.min(request.deadlineAt ?? Infinity, providerRun?.deadlineAt ?? Infinity) });
    if (stopped) return stopped;
    if (request.router.revalidate) {
      const previous = selectedCapabilities;
      selectedCapabilities = await request.router.revalidate(routeRequest, selectedCapabilities);
      if (previous.items.length && !selectedCapabilities.items.length || selectedCapabilities.warnings.some(warning =>
        ["stale_binding", "discovery_unavailable", "discovery_cancelled", "selection_unavailable", "selection_invalid_output", "selection_cancelled"].includes(warning.code))) return "stale_binding";
      toolset = buildRuntimeOpenAIToolset({ builtContext, registry: request.registry, runtimeContext: request.runtimeContext,
        runtimeSlice: selectedCapabilities });
    }
    return undefined;
  };
  const initialStop = stopReason({ signal: runtimeSignal,
    deadlineAt: Math.min(request.deadlineAt ?? Infinity, providerRun?.deadlineAt ?? Infinity) });
  if (initialStop) return finish("cancelled", { errors: [{ code: initialStop, message: "The invocation was cancelled or its deadline elapsed." }] });
  if (!selectedCapabilities.items.length && selectedCapabilities.warnings.some(warning => ["selection_abstained", "selection_not_submitted"].includes(warning.code))
    && !selectedCapabilities.warnings.some(warning => ["discovery_unavailable", "discovery_cancelled"].includes(warning.code))) return finish("completed");
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const invalid = await revalidate();
    if (invalid) return finish(invalid === "cancelled" || invalid === "deadline_exceeded" ? "cancelled" : "failed", {
      errors: [{ code: invalid, message: "The task binding or invocation bounds no longer permit this model turn." }] });
    const providerControl = request.controls?.evaluate({
      model: request.model,
      operation: "provider_call",
      providerId: "openai",
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
      if (providerRun) {
        const execution = providerExecution!;
        const configuration = freezeProviderValue({ ...execution.configuration });
        const prepared = freezeProviderValue({ ...responseRequest, max_output_tokens: execution.maxOutputTokens, truncation: "disabled" });
        const modelIdentity = JSON.stringify(execution.configuration), mock = execution.mock;
        const result = await providerRun.attempt<AicfOpenAIResponseLike>({ requestId, stage: "model_tool_loop", configuration, mock,
          signal: request.signal, deadlineAt: request.deadlineAt, maxInputTokens: execution.maxInputTokens,
          maxOutputTokens: execution.maxOutputTokens, maxEstimatedCostPerCall: execution.maxEstimatedCostPerCall,
          estimateCost: execution.estimateCost, controls: request.controls, runtimeContext: request.runtimeContext,
          guard: () => !executionCurrent() || JSON.stringify(execution.configuration) !== modelIdentity || execution.mock !== mock ? "stale_binding" : undefined,
          invoke: async context => {
            await enforceOpenAIInputTokens({ request: prepared, history: Object.freeze([...history]), configuration, maxInputTokens: execution.maxInputTokens,
              signal: context.signal, deadlineAt: context.deadlineAt }, execution.inputTokenPreflight);
            const changed = await revalidate();
            if (changed) throw Object.assign(new Error("The task binding changed before transport."), { providerAttempts: 0, usage: {} });
            context.beforeProviderCall();
            let completed = false;
            try {
              const value = await clientCreate.call(request.client.responses, prepared, { signal: context.signal,
                timeout: Math.max(1, context.deadlineAt - Date.now()), maxRetries: 0 });
              completed = true;
              return { value, usage: normalizeOpenAIUsage(value?.usage), providerAttempts: 1 };
            } catch (error) {
              const failed = error as { usage?: unknown; providerAttempts?: number; completedResponses?: number } | undefined;
              throw Object.assign(new Error("The managed Responses transport was unavailable."), { usage: normalizeOpenAIUsage(failed?.usage),
                providerAttempts: Number.isSafeInteger(failed?.providerAttempts) && failed!.providerAttempts! >= 0 ? failed!.providerAttempts : 1,
                completedResponses: completed ? 1 : Number.isSafeInteger(failed?.completedResponses) && failed!.completedResponses! >= 0 ? failed!.completedResponses : 0 });
            }
          },
          validate: envelope => {
            const value = (envelope as { value: AicfOpenAIResponseLike }).value;
            return !value || typeof value !== "object" || value.status !== undefined && value.status !== "completed"
              || value.output !== undefined && !Array.isArray(value.output) || value.output_text !== undefined && typeof value.output_text !== "string"
              ? { code: "provider_unavailable" } : { value };
          }
        });
        managedStages.push(...result.usage.stages);
        if (result.code) return finish(result.code === "budget_denied" ? "budget_exceeded"
          : result.code === "control_denied" ? "control_denied" : result.code === "cancelled" || result.code === "deadline_exceeded" ? "cancelled" : "provider_error",
          { errors: [{ code: result.code, message: "The managed model turn was unavailable or denied." }] });
        response = result.value!;
        history.push({ request: prepared, response });
      } else response = await request.client.responses.create(responseRequest);
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

    const changedAfterResponse = await revalidate();
    if (changedAfterResponse) return finish(changedAfterResponse === "cancelled" || changedAfterResponse === "deadline_exceeded" ? "cancelled" : "failed", {
      errors: [{ code: changedAfterResponse, message: "The invocation or task binding changed before the response could be used." }] });
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

    const toolBudgetControl = request.controls?.evaluate({
      model: request.model,
      operation: "provider_call",
      providerId: "openai",
      registry: request.registry,
      runtimeContext: request.runtimeContext,
      usage: {
        providerCalls: turn + 1,
        retries: 0,
        runtimeMs: Date.now() - startedAt,
        toolCalls: toolCallCount + calls.length
      }
    });
    if (toolBudgetControl?.status === "denied") {
      await emit("runtime.error", { code: "budget_exceeded" });
      return finish("budget_exceeded", {
        errors: controlErrors(toolBudgetControl)
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
      const invalid = await revalidate();
      if (invalid) return finish(invalid === "cancelled" || invalid === "deadline_exceeded" ? "cancelled" : "failed", {
        errors: [{ code: invalid, message: "The task binding changed before tool execution." }] });
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
  const controlsDecision = input.request.controls?.evaluate({
    capability,
    capabilityId: capability.manifest.id,
    domain: capability.manifest.domain,
    operation,
    providerId: "openai",
    registry: input.request.registry,
    riskTier: capability.manifest.risk_tier,
    runtimeContext: input.request.runtimeContext
  });
  if (controlsDecision?.status === "denied") {
    return createToolEnvelope({
      capabilityId: capability.manifest.id,
      capabilityVersion: capability.manifest.version,
      operation,
      policy: {
        reasons: controlDecisionToPolicyReasons(controlsDecision),
        requiredApprovals: [],
        status: "denied"
      },
      requestId: input.request.runtimeContext.requestId,
      runId: input.request.runtimeContext.runId,
      status: "denied",
      userMessage: "The provider tool call is not allowed."
    });
  }

  return input.request.executor.execute({
    args: parsed.parsed.args,
    builtContext: input.builtContext,
    capabilityId: parsed.parsed.capabilityId,
    operation,
    runtimeContext: input.request.runtimeContext,
    source: "model_tool_call"
  });
}

function controlErrors(decision: {
  reasons: Array<{ code: string; message: string }>;
}): Array<{ code: string; message: string }> {
  return decision.reasons.length > 0
    ? decision.reasons.map((reason) => ({ code: reason.code, message: reason.message }))
    : [{ code: "control_denied", message: "The runtime controls denied this operation." }];
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
