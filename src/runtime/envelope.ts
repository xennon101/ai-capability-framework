import { AicfRuntimeError } from "./errors.js";
import type {
  AicfRuntimeEnvelopeError,
  AicfRuntimeToolResultEnvelope,
  CreateToolEnvelopeInput,
  ModelSafeEnvelopeOptions
} from "./types.js";

export function createToolEnvelope<TData = unknown>(
  input: CreateToolEnvelopeInput<TData>
): AicfRuntimeToolResultEnvelope<TData> {
  return {
    ...input,
    errors: input.errors?.map(safeEnvelopeError),
    schemaVersion: "1.0"
  };
}

export function toModelSafeToolEnvelope<TData = unknown>(
  envelope: AicfRuntimeToolResultEnvelope<TData>,
  options: ModelSafeEnvelopeOptions = {}
): AicfRuntimeToolResultEnvelope<TData> {
  const includeDiagnostics = options.includeDiagnosticsForModel === true
    && options.environment !== "production";
  const safeEnvelope = {
    ...envelope,
    errors: envelope.errors?.map(safeEnvelopeError)
  };

  if (!includeDiagnostics) {
    delete safeEnvelope.diagnostics;
  }

  return safeEnvelope;
}

export function serializeToolEnvelopeForModel<TData = unknown>(
  envelope: AicfRuntimeToolResultEnvelope<TData>,
  options: ModelSafeEnvelopeOptions = {}
): string {
  return JSON.stringify(toModelSafeToolEnvelope(envelope, options));
}

export function runtimeErrorToEnvelopeError(error: unknown): AicfRuntimeEnvelopeError {
  if (error instanceof AicfRuntimeError) {
    return {
      code: error.code,
      message: error.safeMessage
    };
  }

  return {
    code: "handler_failed",
    message: "The tool could not complete safely."
  };
}

function safeEnvelopeError(error: AicfRuntimeEnvelopeError): AicfRuntimeEnvelopeError {
  return {
    code: error.code,
    message: firstLine(error.message),
    path: error.path
  };
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? "";
}

