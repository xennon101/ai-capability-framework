import type { AicfDiagnostic } from "../../types.js";
import type {
  AicfProviderToolCall,
  ParseProviderToolCallInput,
  ParseProviderToolCallResult
} from "./types.js";

export function parseProviderToolCall(input: ParseProviderToolCallInput): ParseProviderToolCallResult {
  const diagnostics: AicfDiagnostic[] = [];
  const binding = input.toolNameMap.bindingByProviderToolName.get(input.providerToolName);

  if (!binding) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      details: { provider: input.provider, providerToolName: input.providerToolName },
      message: `Provider tool "${input.providerToolName}" does not map to an AICF capability.`,
      path: "providerToolName"
    });
  }

  if (input.requireCallId && !hasText(input.callId)) {
    diagnostics.push({
      code: "provider_tool_call_id_missing",
      details: { provider: input.provider, providerToolName: input.providerToolName },
      message: "Provider tool call did not include a required call ID.",
      path: "callId"
    });
  }

  if (input.args !== undefined && !isRecord(input.args)) {
    diagnostics.push({
      code: "provider_tool_call_parse_failed",
      details: { provider: input.provider, providerToolName: input.providerToolName },
      message: "Provider tool arguments must be a JSON object.",
      path: "args"
    });
  }

  if (!binding || diagnostics.length > 0) {
    return {
      diagnostics,
      valid: false
    };
  }

  const parsed: AicfProviderToolCall = {
    args: input.args === undefined ? {} : { ...input.args },
    callId: input.callId,
    capabilityId: binding.capabilityId,
    provider: input.provider,
    providerToolName: input.providerToolName,
    rawProviderRef: input.rawProviderRef
  };

  return {
    diagnostics,
    parsed,
    valid: true
  };
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
