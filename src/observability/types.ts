import type { AicfRedactionPolicy } from "../runtime/index.js";
import type { JsonValue } from "../types.js";

export type AicfTraceEventType =
  | "runtime.start"
  | "context.build.start"
  | "context.build.end"
  | "capability.route.start"
  | "capability.route.end"
  | "model.call.start"
  | "model.call.end"
  | "tool.call.parsed"
  | "tool.execution.start"
  | "tool.execution.end"
  | "policy.evaluate.start"
  | "policy.evaluate.end"
  | "action.prepare.start"
  | "action.prepare.end"
  | "action.approval.recorded"
  | "action.commit.start"
  | "action.commit.end"
  | "eval.score"
  | "runtime.end"
  | "runtime.error";

export type AicfTraceContentCapture = "none" | "metadata" | "redacted_content";

export interface AicfRuntimeTraceEvent {
  attributes: Record<string, JsonValue>;
  message?: string;
  requestId: string;
  runId: string;
  timestamp: string;
  type: AicfTraceEventType;
}

export interface AicfTraceSink {
  emit(event: AicfRuntimeTraceEvent): Promise<void> | void;
}

export interface AicfTraceRedactionOptions {
  contentCapture?: AicfTraceContentCapture;
  redactionPolicy?: AicfRedactionPolicy;
}

export interface AicfTraceSinkDiagnostic {
  code: string;
  message: string;
  sink?: string;
}

export interface AicfOpenTelemetryOptions {
  contentCapture?: AicfTraceContentCapture;
  tracerApi?: unknown;
  tracerName?: string;
}
