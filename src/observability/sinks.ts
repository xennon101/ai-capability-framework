import { sanitizeTraceEvent } from "./redaction.js";
import type {
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceSink,
  AicfTraceSinkDiagnostic
} from "./types.js";

export class NoopTraceSink implements AicfTraceSink {
  emit(): void {
    // Intentionally empty.
  }
}

export class CollectingTraceSink implements AicfTraceSink {
  readonly diagnostics: AicfTraceSinkDiagnostic[] = [];
  readonly events: AicfRuntimeTraceEvent[] = [];
  private contentCapture: AicfTraceContentCapture;

  constructor(options: {
    contentCapture?: AicfTraceContentCapture;
  } = {}) {
    this.contentCapture = options.contentCapture ?? "metadata";
  }

  emit(event: AicfRuntimeTraceEvent): void {
    this.events.push(sanitizeTraceEvent(event, {
      contentCapture: this.contentCapture
    }));
  }
}

export class CompositeTraceSink implements AicfTraceSink {
  readonly diagnostics: AicfTraceSinkDiagnostic[] = [];
  private sinks: AicfTraceSink[];

  constructor(sinks: AicfTraceSink[]) {
    this.sinks = sinks;
  }

  async emit(event: AicfRuntimeTraceEvent): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.emit(event);
      } catch {
        this.diagnostics.push({
          code: "trace_sink_failed",
          message: "A trace sink failed while emitting an event.",
          sink: sink.constructor.name
        });
      }
    }
  }
}
