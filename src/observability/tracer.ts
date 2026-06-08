import type { JsonValue } from "../types.js";
import { OpenTelemetryTraceSink } from "./otel.js";
import { sanitizeTraceEvent } from "./redaction.js";
import type {
  AicfRuntimeTraceEvent,
  AicfRunSpan,
  AicfTraceSink,
  AicfTracer,
  AicfTraceContentCapture,
  CapabilitySliceEvent,
  EvalScoreEvent,
  ProviderCallEvent,
  StartRunInput,
  ToolCallEvent
} from "./types.js";

export class NoopTracer implements AicfTracer {
  startRun(input: StartRunInput): AicfRunSpan {
    return new TraceRunSpan({
      input,
      recorder: () => undefined
    });
  }
}

export class InMemoryTracer implements AicfTracer {
  readonly events: AicfRuntimeTraceEvent[] = [];
  private contentCapture: AicfTraceContentCapture;

  constructor(options: { contentCapture?: AicfTraceContentCapture } = {}) {
    this.contentCapture = options.contentCapture ?? "metadata";
  }

  startRun(input: StartRunInput): AicfRunSpan {
    return new TraceRunSpan({
      input,
      recorder: (event) => {
        this.events.push(sanitizeTraceEvent(event, { contentCapture: this.contentCapture }));
      }
    });
  }
}

export class TraceSinkTracer implements AicfTracer {
  private sink: AicfTraceSink;
  private contentCapture: AicfTraceContentCapture;

  constructor(sink: AicfTraceSink, options: { contentCapture?: AicfTraceContentCapture } = {}) {
    this.sink = sink;
    this.contentCapture = options.contentCapture ?? "metadata";
  }

  startRun(input: StartRunInput): AicfRunSpan {
    return new TraceRunSpan({
      input,
      recorder: (event) => this.sink.emit(sanitizeTraceEvent(event, { contentCapture: this.contentCapture }))
    });
  }
}

export class OpenTelemetryTracerAdapter extends TraceSinkTracer {
  constructor(options: ConstructorParameters<typeof OpenTelemetryTraceSink>[0] = {}) {
    super(new OpenTelemetryTraceSink(options), { contentCapture: options.contentCapture });
  }
}

class TraceRunSpan implements AicfRunSpan {
  private input: StartRunInput;
  private recorder: (event: AicfRuntimeTraceEvent) => Promise<void> | void;

  constructor(options: {
    input: StartRunInput;
    recorder: (event: AicfRuntimeTraceEvent) => Promise<void> | void;
  }) {
    this.input = options.input;
    this.recorder = options.recorder;
    void this.emit("runtime.start", options.input.metadata ?? {}, options.input.startedAt);
  }

  async end(output: { status?: string; timestamp?: string; [key: string]: JsonValue | undefined } = {}): Promise<void> {
    const { timestamp, ...attributes } = output;
    await this.emit("runtime.end", withoutUndefined(attributes), timestamp);
  }

  async error(error: unknown, metadata: Record<string, JsonValue> = {}): Promise<void> {
    await this.emit("runtime.error", {
      ...metadata,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: safeErrorMessage(error instanceof Error ? error.message : String(error))
    });
  }

  async recordAction(event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }): Promise<void> {
    await this.emitWithOverrides("action.prepare.end", event);
  }

  async recordApproval(event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }): Promise<void> {
    await this.emitWithOverrides("action.approval.recorded", event);
  }

  async recordCapabilitySlice(event: CapabilitySliceEvent): Promise<void> {
    const { requestId, runId, timestamp, ...attributes } = event;
    await this.recorder({
      attributes: {
        ...attributes,
        capabilityCount: event.capabilityIds.length
      },
      requestId,
      runId,
      timestamp: timestamp ?? nowIso(),
      type: "capability.route.end"
    });
  }

  async recordPolicyDecision(event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }): Promise<void> {
    await this.emitWithOverrides("policy.evaluate.end", event);
  }

  async recordProviderCall(event: ProviderCallEvent): Promise<void> {
    const { requestId, runId, timestamp, ...attributes } = event;
    await this.recorder({
      attributes,
      requestId,
      runId,
      timestamp: timestamp ?? nowIso(),
      type: event.status === "error" ? "runtime.error" : "model.call.end"
    });
  }

  async recordToolCall(event: ToolCallEvent): Promise<void> {
    const { requestId, runId, timestamp, ...attributes } = event;
    await this.recorder({
      attributes,
      requestId,
      runId,
      timestamp: timestamp ?? nowIso(),
      type: "tool.execution.end"
    });
  }

  async recordEvalScore(event: EvalScoreEvent): Promise<void> {
    const { requestId, runId, timestamp, ...attributes } = event;
    await this.recorder({
      attributes,
      requestId,
      runId,
      timestamp: timestamp ?? nowIso(),
      type: "eval.score"
    });
  }

  private async emitWithOverrides(
    type: AicfRuntimeTraceEvent["type"],
    event: Record<string, JsonValue> & { requestId?: string; timestamp?: string }
  ): Promise<void> {
    const { requestId, timestamp, ...attributes } = event;
    await this.emit(type, attributes, timestamp, requestId);
  }

  private async emit(
    type: AicfRuntimeTraceEvent["type"],
    attributes: Record<string, JsonValue>,
    timestamp?: string,
    requestId = this.input.requestId
  ): Promise<void> {
    await this.recorder({
      attributes,
      requestId,
      runId: this.input.runId,
      timestamp: timestamp ?? nowIso(),
      type
    });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0] ?? "Runtime error.";
}

function withoutUndefined(value: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = child;
    }
  }
  return output;
}

function safeErrorMessage(value: string): string {
  return firstLine(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\b(secret|token|password|api[_-]?key|cookie|credential)\b/gi, "[REDACTED]");
}
