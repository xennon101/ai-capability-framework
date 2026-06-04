export class AicfOpenAIRuntimeError extends Error {
  code:
    | "missing_openai_sdk"
    | "missing_agents_sdk"
    | "invalid_openai_client"
    | "invalid_tool_call"
    | "provider_error"
    | "tool_limit_exceeded"
    | "turn_limit_exceeded";
  safeMessage: string;

  constructor(input: {
    code: AicfOpenAIRuntimeError["code"];
    message?: string;
    safeMessage: string;
  }) {
    super(input.message ?? input.safeMessage);
    this.name = "AicfOpenAIRuntimeError";
    this.code = input.code;
    this.safeMessage = input.safeMessage;
  }
}

export function safeOpenAIError(error: unknown): { code: string; message: string } {
  if (error instanceof AicfOpenAIRuntimeError) {
    return {
      code: error.code,
      message: error.safeMessage
    };
  }

  return {
    code: "provider_error",
    message: "The OpenAI request failed."
  };
}
