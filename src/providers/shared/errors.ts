import type { AicfErrorCode } from "../../types.js";
import type { AicfProviderId } from "./types.js";

export type AicfProviderErrorCode = Extract<AicfErrorCode,
  | "provider_dependency_missing"
  | "provider_loop_max_iterations"
  | "provider_loop_max_tool_calls"
  | "provider_response_unrecognized"
  | "provider_schema_normalization_failed"
  | "provider_schema_unsupported"
  | "provider_sdk_error"
  | "provider_tool_call_id_missing"
  | "provider_tool_call_parse_failed"
  | "provider_tool_name_collision"
  | "provider_tool_name_invalid"
  | "provider_tool_result_format_failed"
>;

export class AicfProviderError extends Error {
  code: AicfProviderErrorCode;
  details?: Record<string, unknown>;
  provider?: AicfProviderId;
  safeMessage: string;

  constructor(input: {
    code: AicfProviderErrorCode;
    details?: Record<string, unknown>;
    message?: string;
    provider?: AicfProviderId;
    safeMessage: string;
  }) {
    super(input.message ?? input.safeMessage);
    this.name = "AicfProviderError";
    this.code = input.code;
    this.details = input.details;
    this.provider = input.provider;
    this.safeMessage = input.safeMessage;
  }
}

export function providerErrorToSafeObject(error: unknown): { code: string; message: string } {
  if (error instanceof AicfProviderError) {
    return {
      code: error.code,
      message: error.safeMessage
    };
  }

  return {
    code: "provider_sdk_error",
    message: "The provider operation failed safely."
  };
}
