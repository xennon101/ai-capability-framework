import { serializeToolEnvelopeForModel, toModelSafeToolEnvelope } from "../../runtime/index.js";
import type { AicfProviderToolResult, BuildProviderToolResultInput } from "./types.js";

export function buildProviderToolResult(input: BuildProviderToolResultInput): AicfProviderToolResult {
  const modelSafeEnvelope = toModelSafeToolEnvelope(input.envelope, {
    environment: input.runtimeContext?.environment
  });
  return {
    callId: input.providerCall.callId,
    capabilityId: input.providerCall.capabilityId,
    envelope: modelSafeEnvelope,
    isError: isErrorStatus(modelSafeEnvelope.status),
    output: serializeToolEnvelopeForModel(input.envelope, {
      environment: input.runtimeContext?.environment
    }),
    provider: input.providerCall.provider,
    providerToolName: input.providerCall.providerToolName
  };
}

function isErrorStatus(status: string): boolean {
  return ["denied", "failed", "unavailable", "validation_error"].includes(status);
}
