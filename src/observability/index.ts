export { createTraceEvent, sanitizeTraceAttributes, sanitizeTraceEvent, traceContextRedactionPolicy } from "./redaction.js";
export { emitTraceEvent } from "./events.js";
export { NoopTraceSink, CollectingTraceSink, CompositeTraceSink } from "./sinks.js";
export { OpenTelemetryTraceSink, toOpenTelemetryAttributes } from "./otel.js";
export type {
  AicfOpenTelemetryOptions,
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceEventType,
  AicfTraceRedactionOptions,
  AicfTraceSink,
  AicfTraceSinkDiagnostic
} from "./types.js";
