export function safeAiSdkError(_error: unknown): { code: string; message: string } {
  return {
    code: "provider_sdk_error",
    message: "The Vercel AI SDK bridge request failed."
  };
}
