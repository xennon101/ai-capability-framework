import {
  parseOpenAIResponsesToolCall,
  type OpenAIResponsesFunctionCall,
  type OpenAIResponsesToolset
} from "../index.js";
import {
  serializeToolEnvelopeForModel,
  type AicfRuntimeToolResultEnvelope
} from "../runtime/index.js";
import type {
  AicfOpenAIResponseLike,
  BuildOpenAIFunctionCallOutputOptions
} from "./types.js";

export function extractOpenAIResponsesFunctionCalls(
  response: AicfOpenAIResponseLike
): OpenAIResponsesFunctionCall[] {
  return (response.output ?? [])
    .filter(isFunctionCallLike)
    .map((item) => ({
      arguments: item.arguments,
      call_id: item.call_id,
      id: item.id,
      name: item.name,
      type: "function_call"
    }));
}

export function parseOpenAIRuntimeToolCall(
  toolset: OpenAIResponsesToolset,
  call: OpenAIResponsesFunctionCall
) {
  return parseOpenAIResponsesToolCall(toolset, call);
}

export function buildOpenAIFunctionCallOutput(
  call: Pick<OpenAIResponsesFunctionCall, "call_id">,
  envelope: AicfRuntimeToolResultEnvelope,
  options: BuildOpenAIFunctionCallOutputOptions = {}
): {
  call_id: string;
  output: string;
  type: "function_call_output";
} {
  if (!call.call_id || call.call_id.trim().length === 0) {
    throw new Error("OpenAI function call output requires call_id.");
  }

  return {
    call_id: call.call_id,
    output: serializeToolEnvelopeForModel(envelope, {
      includeDiagnosticsForModel: options.includeDiagnosticsForModel
    }),
    type: "function_call_output"
  };
}

function isFunctionCallLike(value: unknown): value is {
  arguments: string;
  call_id?: string;
  id?: string;
  name: string;
  type: "function_call";
} {
  return typeof value === "object"
    && value !== null
    && (value as { type?: unknown }).type === "function_call"
    && typeof (value as { name?: unknown }).name === "string"
    && typeof (value as { arguments?: unknown }).arguments === "string";
}

