import { createTraceEvent } from "./redaction.js";
import type {
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceSink
} from "./types.js";

export async function emitTraceEvent(input: {
  attributes?: Record<string, unknown>;
  contentCapture?: AicfTraceContentCapture;
  events?: AicfRuntimeTraceEvent[];
  message?: string;
  requestId: string;
  runId: string;
  sink?: AicfTraceSink;
  timestamp?: string;
  type: AicfRuntimeTraceEvent["type"];
}): Promise<AicfRuntimeTraceEvent> {
  const event = createTraceEvent(input);
  input.events?.push(event);

  if (input.sink) {
    try {
      await input.sink.emit(event);
    } catch {
      const diagnosticEvent = createTraceEvent({
        attributes: {
          failedEventType: event.type
        },
        contentCapture: "metadata",
        message: "A trace sink failed while emitting an event.",
        requestId: input.requestId,
        runId: input.runId,
        timestamp: input.timestamp,
        type: "runtime.error"
      });
      input.events?.push(diagnosticEvent);
    }
  }

  return event;
}
