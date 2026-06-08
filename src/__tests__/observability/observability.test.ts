import { describe, expect, it } from "vitest";
import {
  CollectingTraceSink,
  CompositeTraceSink,
  InMemoryTracer,
  NoopTracer,
  OpenTelemetryTracerAdapter,
  NoopTraceSink,
  OpenTelemetryTraceSink,
  sanitizeTraceAttributes,
  toOpenTelemetryAttributes,
  TraceSinkTracer,
  type AicfRuntimeTraceEvent
} from "../../observability/index.js";

const traceEvent: AicfRuntimeTraceEvent = {
  attributes: {
    apiKey: "secret",
    model: "gpt-4.1-mini",
    provider: "openai",
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

  it("supports no-op, in-memory, sink-backed, and OpenTelemetry tracer APIs", async () => {
    const noop = new NoopTracer();
    const noopRun = noop.startRun({ requestId: "req_1", runId: "run_1" });
    await expect(noopRun.end({ status: "ok" })).resolves.toBeUndefined();

    const tracer = new InMemoryTracer();
    const run = tracer.startRun({
      metadata: { workflow: "support" },
      requestId: "req_1",
      runId: "run_1",
      startedAt: "2026-06-04T00:00:00.000Z"
    });
    await run.recordCapabilitySlice({
      capabilityIds: ["support.ticket.get"],
      requestId: "req_1",
      runId: "run_1",
      timestamp: "2026-06-04T00:00:01.000Z"
    });
    await run.recordToolCall({
      capabilityId: "support.ticket.get",
      operation: "read",
      requestId: "req_1",
      runId: "run_1",
      timestamp: "2026-06-04T00:00:02.000Z"
    });
    await run.recordPolicyDecision({
      capabilityId: "support.ticket.get",
      policyStatus: "allowed"
    });
    await run.recordAction({
      actionState: "prepared",
      capabilityId: "support.refund.prepare_case"
    });
    await run.recordApproval({
      actionState: "approved",
      approvalId: "approval_1"
    });
    await run.recordProviderCall({
      model: "gpt-4.1-mini",
      provider: "openai",
      requestId: "req_1",
      runId: "run_1"
    });
    await run.recordEvalScore({
      evalId: "support.ticket.get.valid",
      requestId: "req_1",
      runId: "run_1",
      score: 1,
      scorer: "tool_selection_includes"
    });
    await run.error(new Error("secret stack\nline two"), { apiKey: "secret" });
    await run.end({ status: "ok" });

    expect(tracer.events.map((event) => event.type)).toEqual([
      "runtime.start",
      "capability.route.end",
      "tool.execution.end",
      "policy.evaluate.end",
      "action.prepare.end",
      "action.approval.recorded",
      "model.call.end",
      "eval.score",
      "runtime.error",
      "runtime.end"
    ]);
    expect(JSON.stringify(tracer.events)).not.toContain("secret");

    const collecting = new CollectingTraceSink();
    const sinkTracer = new TraceSinkTracer(collecting);
    await sinkTracer.startRun({ requestId: "req_2", runId: "run_2" }).end({ status: "ok" });
    expect(collecting.events.map((event) => event.type)).toEqual(["runtime.start", "runtime.end"]);

    const spans: Array<{ attributes: Record<string, unknown>; name: string }> = [];
    const otel = new OpenTelemetryTracerAdapter({
      tracerApi: {
        startSpan(name: string, options?: { attributes?: Record<string, unknown> }) {
          spans.push({ attributes: options?.attributes ?? {}, name });
          return { end() { return undefined; } };
        }
      }
    });
    const otelRun = otel.startRun({ requestId: "req_3", runId: "run_3" });
    await otelRun.recordProviderCall({
      model: "claude-sonnet",
      provider: "anthropic",
      requestId: "req_3",
      runId: "run_3"
    });
    expect(spans.some((span) => span.attributes["gen_ai.provider.name"] === "anthropic")).toBe(true);
  });

  it("uses provider metadata for model-call attribution without defaulting to OpenAI", () => {
    expect(toOpenTelemetryAttributes({
      ...traceEvent,
      attributes: { model: "gpt-4.1-mini", provider: "openai" }
    })["gen_ai.provider.name"]).toBe("openai");
    expect(toOpenTelemetryAttributes({
      ...traceEvent,
      attributes: { model: "claude-sonnet", provider: "anthropic" }
    })["gen_ai.provider.name"]).toBe("anthropic");
    expect(toOpenTelemetryAttributes({
      ...traceEvent,
      attributes: { model: "gemini-2.5-pro", provider: "gemini" }
    })["gen_ai.provider.name"]).toBe("gemini");
    expect(toOpenTelemetryAttributes({
      ...traceEvent,
      attributes: { model: "unknown" }
    })["gen_ai.provider.name"]).toBeUndefined();
  });

  it("exports built observability subpath APIs", async () => {
    const observability = await import("../../../dist/observability/index.js") as Record<string, unknown>;

    expect(observability.CollectingTraceSink).toEqual(expect.any(Function));
    expect(observability.CompositeTraceSink).toEqual(expect.any(Function));
    expect(observability.InMemoryTracer).toEqual(expect.any(Function));
    expect(observability.NoopTracer).toEqual(expect.any(Function));
    expect(observability.OpenTelemetryTracerAdapter).toEqual(expect.any(Function));
    expect(observability.OpenTelemetryTraceSink).toEqual(expect.any(Function));
    expect(observability.TraceSinkTracer).toEqual(expect.any(Function));
  });
});
