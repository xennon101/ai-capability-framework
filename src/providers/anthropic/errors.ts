import { AicfProviderError, providerErrorToSafeObject } from "../shared/errors.js";

export function safeAnthropicError(error: unknown): { code: string; message: string } {
  if (error instanceof AicfProviderError) {
    return providerErrorToSafeObject(error);
  }

  return {
    code: "provider_sdk_error",
    message: "The Anthropic Messages request failed."
  };
}
