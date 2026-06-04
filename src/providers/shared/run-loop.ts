import Ajv2020 from "ajv/dist/2020.js";
import { createToolEnvelope } from "../../runtime/index.js";
import type {
  AicfRuntimeToolResultEnvelope,
  AicfToolExecutionRequest
} from "../../runtime/index.js";
import type { LoadedCapabilityManifest } from "../../types.js";
import { buildProviderToolResult } from "./tool-result.js";
import type {
  AicfProviderToolResult,
  ExecuteProviderToolCallInput
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export async function executeProviderToolCall(input: ExecuteProviderToolCallInput): Promise<AicfProviderToolResult> {
  const binding = input.toolNameMap.bindingByProviderToolName.get(input.providerCall.providerToolName);
  if (!binding) {
    return resultFromEnvelope(input, unavailableEnvelope(input, input.providerCall.capabilityId || "unknown", "Provider tool does not map to an AICF capability."));
  }

  const capability = input.registry.capabilityById.get(binding.capabilityId);
  if (!capability) {
    return resultFromEnvelope(input, unavailableEnvelope(input, binding.capabilityId, "Mapped AICF capability was not found."));
  }

  if (input.runtimeSlice && !input.runtimeSlice.items.some((item) => item.capabilityId === binding.capabilityId)) {
    return resultFromEnvelope(input, deniedEnvelope(input, capability, binding.operation, "Capability is not present in the routed provider slice."));
  }

  if (binding.operation === "commit" || capability.manifest.lifecycle.commit || capability.manifest.capability_type === "write_commit") {
    return resultFromEnvelope(input, deniedEnvelope(input, capability, "commit", "Commit capabilities are not executable through provider tool calls."));
  }

  const operation = binding.operation === "prepare" ? "prepare" : "read";
  const validation = validateArgs(capability, input.providerCall.args);
  if (!validation.valid) {
    return resultFromEnvelope(input, createToolEnvelope({
      capabilityId: capability.manifest.id,
      capabilityVersion: capability.manifest.version,
      errors: validation.errors,
      operation,
      requestId: input.runtimeContext.requestId,
      runId: input.runtimeContext.runId,
      status: "validation_error",
      userMessage: "The provider tool input was invalid."
    }));
  }

  const envelope = await input.executor.execute({
    args: input.providerCall.args,
    builtContext: input.builtContext,
    capabilityId: binding.capabilityId,
    operation,
    runtimeContext: input.runtimeContext,
    source: input.source ?? "model_tool_call"
  });
  return resultFromEnvelope(input, envelope);
}

function resultFromEnvelope(
  input: ExecuteProviderToolCallInput,
  envelope: AicfRuntimeToolResultEnvelope
): AicfProviderToolResult {
  return buildProviderToolResult({
    envelope,
    providerCall: input.providerCall,
    runtimeContext: input.runtimeContext
  });
}

function unavailableEnvelope(
  input: ExecuteProviderToolCallInput,
  capabilityId: string,
  message: string
): AicfRuntimeToolResultEnvelope {
  return createToolEnvelope({
    capabilityId,
    errors: [{
      code: "provider_tool_call_parse_failed",
      message
    }],
    operation: "read",
    requestId: input.runtimeContext.requestId,
    runId: input.runtimeContext.runId,
    status: "unavailable",
    userMessage: "The provider tool is unavailable."
  });
}

function deniedEnvelope(
  input: ExecuteProviderToolCallInput,
  capability: LoadedCapabilityManifest,
  operation: AicfToolExecutionRequest["operation"] | "commit",
  message: string
): AicfRuntimeToolResultEnvelope {
  return createToolEnvelope({
    capabilityId: capability.manifest.id,
    capabilityVersion: capability.manifest.version,
    errors: [{
      code: "policy_denied",
      message
    }],
    operation,
    requestId: input.runtimeContext.requestId,
    runId: input.runtimeContext.runId,
    status: "denied",
    userMessage: "The provider tool call is not allowed."
  });
}

function validateArgs(
  capability: LoadedCapabilityManifest,
  args: Record<string, unknown>
): { errors: Array<{ code: string; message: string; path?: string }>; valid: boolean } {
  const validate = ajv.compile(capability.manifest.input_schema);
  if (validate(args)) {
    return {
      errors: [],
      valid: true
    };
  }

  return {
    errors: (validate.errors ?? []).map((error) => ({
      code: "schema_validation_failed",
      message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`
    })),
    valid: false
  };
}
