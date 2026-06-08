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

export interface StartRunInput {
  metadata?: Record<string, JsonValue>;
  requestId: string;
  runId: string;
  startedAt?: string;
}

export interface CapabilitySliceEvent {
  capabilityIds: string[];
  excludedCapabilityIds?: string[];
  requestId: string;
  runId: string;
  selectedCount?: number;
  timestamp?: string;
}

export interface ToolCallEvent {
  argsHash?: string;
  callId?: string;
  capabilityId: string;
  operation?: string;
  provider?: string;
  requestId: string;
  runId: string;
  status?: string;
  timestamp?: string;
}

export interface ProviderCallEvent {
  model?: string;
  provider?: string;
  requestId: string;
  responseId?: string;
  runId: string;
  status?: string;
  timestamp?: string;
}

export interface EvalScoreEvent {
  evalId: string;
  requestId: string;
  runId: string;
  score: number;
  scorer: string;
  status?: string;
  timestamp?: string;
}

export interface AicfRunSpan {
  end(output?: { status?: string; timestamp?: string; [key: string]: JsonValue | undefined }): Promise<void> | void;
  error(error: unknown, metadata?: Record<string, JsonValue>): Promise<void> | void;
  recordAction(event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }): Promise<void> | void;
  recordApproval(event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }): Promise<void> | void;
  recordCapabilitySlice(event: CapabilitySliceEvent): Promise<void> | void;
  recordPolicyDecision(event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }): Promise<void> | void;
  recordProviderCall(event: ProviderCallEvent): Promise<void> | void;
  recordToolCall(event: ToolCallEvent): Promise<void> | void;
  recordEvalScore(event: EvalScoreEvent): Promise<void> | void;
}

export interface AicfTracer {
  startRun(input: StartRunInput): AicfRunSpan;
}
