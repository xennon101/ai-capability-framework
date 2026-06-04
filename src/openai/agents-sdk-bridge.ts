import { buildOpenAIResponsesTools } from "../openai-responses.js";
import {
  serializeToolEnvelopeForModel,
  type AicfRuntimeUserInput
} from "../runtime/index.js";
import { AicfOpenAIRuntimeError } from "./errors.js";
import {
  openAIDecisionContext,
  runtimeSliceToCoreSlice
} from "./tool-loop.js";
import type {
  AicfAgentsSdkBridgeOptions,
  AicfAgentsSdkToolBridgeFactory,
  AicfAgentsSdkToolDefinition,
  CreateDefaultAgentsSdkBridgeFactoryOptions
} from "./types.js";

const plainFactory: AicfAgentsSdkToolBridgeFactory = {
  createFunctionTool(input) {
    return {
      description: input.description,
      execute: input.execute,
      invoke: async (_runContext: unknown, rawInput: unknown, details?: unknown) => input.execute(parseToolInput(rawInput), _runContext, details),
      name: input.name,
      needsApproval: input.needsApproval ?? false,
      parameters: input.parameters,
      strict: input.strict,
      type: "function"
    };
  }
};

export async function buildAgentsSdkTools(options: AicfAgentsSdkBridgeOptions): Promise<unknown[]> {
  const userInput = options.userInput ?? defaultAgentsUserInput();
  const runtimeSlice = await options.router.route({
    builtContext: options.builtContext,
    maxCapabilities: options.maxCapabilities,
    registry: options.registry,
    userInput
  });
  const toolset = buildOpenAIResponsesTools(runtimeSliceToCoreSlice({
    registry: options.registry,
    runtimeSlice
  }), {
    context: openAIDecisionContext(options.runtimeContext)
  });
  const factory = options.factory ?? plainFactory;
  const tools: unknown[] = [];

  for (const binding of toolset.bindings) {
    const functionTool = toolset.tools.find((tool) => tool.name === binding.toolName);
    const capability = options.registry.capabilityById.get(binding.capabilityId);
    if (!functionTool || !capability) {
      continue;
    }
    if (capability.manifest.lifecycle.commit || capability.manifest.capability_type === "write_commit") {
      continue;
    }

    const operation = capability.manifest.lifecycle.prepare ? "prepare" : "read";
    const definition: AicfAgentsSdkToolDefinition = {
      description: functionTool.description,
      execute: async (input) => {
        const envelope = await options.executor.execute({
          args: isRecord(input) ? input : {},
          builtContext: options.builtContext,
          capabilityId: binding.capabilityId,
          operation,
          runtimeContext: options.runtimeContext,
          source: "model_tool_call"
        });
        return serializeToolEnvelopeForModel(envelope);
      },
      name: functionTool.name,
      needsApproval: false,
      parameters: functionTool.parameters,
      strict: true
    };
    tools.push(factory.createFunctionTool(definition));
  }

  return tools;
}

export async function createDefaultAgentsSdkBridgeFactory(
  options: CreateDefaultAgentsSdkBridgeFactoryOptions = {}
): Promise<AicfAgentsSdkToolBridgeFactory> {
  try {
    const moduleName = options.moduleName ?? "@openai/agents";
    const imported = await import(moduleName);
    const tool = (imported as { tool?: unknown }).tool;
    if (typeof tool !== "function") {
      throw new Error("Agents SDK tool() export was not found.");
    }

    return {
      createFunctionTool(input) {
        return (tool as (definition: Record<string, unknown>) => unknown)({
          description: input.description,
          errorFunction: () => "The AICF tool failed safely.",
          execute: async (toolInput: unknown, context?: unknown, details?: unknown) => input.execute(toolInput, context, details),
          name: input.name,
          needsApproval: input.needsApproval ?? false,
          parameters: input.parameters,
          strict: input.strict
        });
      }
    };
  } catch (error) {
    throw new AicfOpenAIRuntimeError({
      code: "missing_agents_sdk",
      message: error instanceof Error ? error.message : undefined,
      safeMessage: "The optional OpenAI Agents SDK is not installed. Install @openai/agents or pass a compatible tool factory."
    });
  }
}

function defaultAgentsUserInput(): AicfRuntimeUserInput {
  return {
    text: ""
  };
}

function parseToolInput(input: unknown): unknown {
  if (typeof input !== "string") {
    return input;
  }

  try {
    return JSON.parse(input) as unknown;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
