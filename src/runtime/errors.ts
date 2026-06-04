import type { AicfRuntimeErrorCode } from "./types.js";

export class AicfRuntimeError extends Error {
  code: AicfRuntimeErrorCode;
  details?: Record<string, unknown>;
  safeMessage: string;

  constructor(input: {
    code: AicfRuntimeErrorCode;
    details?: Record<string, unknown>;
    message?: string;
    safeMessage: string;
  }) {
    super(input.message ?? input.safeMessage);
    this.name = "AicfRuntimeError";
    this.code = input.code;
    this.safeMessage = input.safeMessage;
    this.details = input.details;
  }
}

export function toAicfRuntimeError(
  error: unknown,
  fallback: {
    code: AicfRuntimeErrorCode;
    safeMessage: string;
  }
): AicfRuntimeError {
  if (error instanceof AicfRuntimeError) {
    return error;
  }

  return new AicfRuntimeError({
    code: fallback.code,
    details: error instanceof Error ? { name: error.name } : undefined,
    message: error instanceof Error ? error.message : fallback.safeMessage,
    safeMessage: fallback.safeMessage
  });
}

