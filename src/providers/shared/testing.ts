import type {
  AicfProviderId,
  AicfProviderToolCall,
  AicfProviderToolNameBinding
} from "./types.js";

export function createMockProviderToolCall(input: {
  args?: Record<string, unknown>;
  callId?: string;
  capabilityId?: string;
  provider?: AicfProviderId;
  providerToolName: string;
}): AicfProviderToolCall {
  return {
    args: input.args ?? {},
    callId: input.callId ?? "provider_call_test_1",
    capabilityId: input.capabilityId ?? "unknown",
    provider: input.provider ?? "openai",
    providerToolName: input.providerToolName,
    rawProviderRef: {
      id: input.callId ?? "provider_call_test_1",
      type: "test_tool_call"
    }
  };
}

export function createMockProviderToolNameBinding(input: {
  capabilityId: string;
  operation?: AicfProviderToolNameBinding["operation"];
  provider?: AicfProviderId;
  providerToolName: string;
}): AicfProviderToolNameBinding {
  return {
    capabilityId: input.capabilityId,
    operation: input.operation ?? "read",
    originalInputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object"
    },
    provider: input.provider ?? "openai",
    providerToolName: input.providerToolName,
    restricted: false
  };
}
