import { describe, expect, it } from "vitest";
import {
  CollectingTraceSink,
  CompositeTraceSink,
  NoopTraceSink,
  OpenTelemetryTraceSink,
  sanitizeTraceAttributes,
  type AicfRuntimeTraceEvent
} from "../../observability/index.js";

const traceEvent: AicfRuntimeTraceEvent = {
  attributes: {
    apiKey: "secret",
    model: "gpt-4.1-mini",
    rawPrompt: "show card 4111111111111111",
    userText: "hello"
  },
  requestId: "req_test",
  runId: "run_test",
  timestamp: "2026-06-04T00:00:00.000Z",
  type: "model.call.start"
};

describe("observability trace sinks", () => {
  it("no-ops, collects metadata-redacted events, and isolates sink failures", async () => {
    const noop = new NoopTraceSink();
    const collecting = new CollectingTraceSink();
    const failing = {
      emit() {
        throw new Error("sink failed");
      }
    };
    const composite = new CompositeTraceSink([noop, collecting, failing]);

    await composite.emit(traceEvent);

    expect(collecting.events).toHaveLength(1);
    expect(collecting.events[0]?.attributes.apiKey).toBe("[REDACTED]");
    expect(collecting.events[0]?.attributes.rawPrompt).toEqual({
      characters: 26,
      omitted: true
    });
    expect(composite.diagnostics).toContainEqual(expect.objectContaining({
      code: "trace_sink_failed"
    }));
  });

  it("supports content capture modes", () => {
    const none = sanitizeTraceAttributes(traceEvent.attributes, "none");
    const metadata = sanitizeTraceAttributes(traceEvent.attributes, "metadata");
    const redacted = sanitizeTraceAttributes(traceEvent.attributes, "redacted_content");

    expect(none.rawPrompt).toBeUndefined();
    expect(metadata.rawPrompt).toEqual({ characters: 26, omitted: true });
    expect(redacted.rawPrompt).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
  });

  it("maps OpenTelemetry attributes through a fake tracer API", () => {
    const spans: Array<{ attributes: Record<string, unknown>; name: string }> = [];
    const tracerApi = {
      trace: {
        getTracer: () => ({
          startSpan(name: string, options?: { attributes?: Record<string, unknown> }) {
            spans.push({
              attributes: options?.attributes ?? {},
              name
            });
            return {
              end() {
                return undefined;
              }
            };
          }
        })
      }
    };
    const sink = new OpenTelemetryTraceSink({ tracerApi });

    sink.emit(traceEvent);

    expect(spans[0]?.name).toBe("chat gpt-4.1-mini");
    expect(spans[0]?.attributes["gen_ai.provider.name"]).toBe("openai");
    expect(spans[0]?.attributes["aicf.run_id"]).toBe("run_test");
  });

  it("exports built observability subpath APIs", async () => {
    const observability = await import("../../../dist/observability/index.js") as Record<string, unknown>;

    expect(observability.CollectingTraceSink).toEqual(expect.any(Function));
    expect(observability.CompositeTraceSink).toEqual(expect.any(Function));
    expect(observability.OpenTelemetryTraceSink).toEqual(expect.any(Function));
  });
});
