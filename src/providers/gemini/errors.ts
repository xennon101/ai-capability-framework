import { AicfProviderError, providerErrorToSafeObject } from "../shared/errors.js";

export function safeGeminiError(error: unknown): { code: string; message: string } {
  if (error instanceof AicfProviderError) {
    return providerErrorToSafeObject(error);
  }

  return {
    code: "provider_sdk_error",
    message: "The Gemini GenerateContent request failed."
  };
}
