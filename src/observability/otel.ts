import { sanitizeTraceEvent } from "./redaction.js";
import type {
  AicfOpenTelemetryOptions,
  AicfRuntimeTraceEvent,
  AicfTraceContentCapture,
  AicfTraceSink,
  AicfTraceSinkDiagnostic
} from "./types.js";

export class OpenTelemetryTraceSink implements AicfTraceSink {
  readonly diagnostics: AicfTraceSinkDiagnostic[] = [];
  private contentCapture: AicfTraceContentCapture;
  private tracer: {
    startSpan(name: string, options?: Record<string, unknown>): {
      end(): void;
      recordException?(error: unknown): void;
      setAttribute?(key: string, value: unknown): void;
      setAttributes?(attributes: Record<string, unknown>): void;
      setStatus?(status: Record<string, unknown>): void;
    };
  } | null;

  constructor(options: AicfOpenTelemetryOptions = {}) {
    this.contentCapture = options.contentCapture ?? "metadata";
    this.tracer = resolveTracer(options.tracerApi, options.tracerName ?? "ai-capability-framework");
    if (!this.tracer) {
      this.diagnostics.push({
        code: "otel_tracer_unavailable",
        message: "OpenTelemetry tracer API was not available."
      });
    }
  }

  emit(event: AicfRuntimeTraceEvent): void {
    if (!this.tracer) {
      return;
    }

    const sanitized = sanitizeTraceEvent(event, {
      contentCapture: this.contentCapture
    });
    const attributes = toOpenTelemetryAttributes(sanitized);
    const span = this.tracer.startSpan(spanName(sanitized), { attributes });

    if (sanitized.type.endsWith(".error")) {
      span.setStatus?.({
        code: 2,
        message: sanitized.message ?? "AICF runtime error."
      });
    }

    span.end();
  }
}

export function toOpenTelemetryAttributes(event: AicfRuntimeTraceEvent): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    "aicf.event.type": event.type,
    "aicf.request_id": event.requestId,
    "aicf.run_id": event.runId,
    ...event.attributes
  };

  const model = stringAttribute(event.attributes.model);
  if (model) {
    attributes["gen_ai.request.model"] = model;
  }

  const responseId = stringAttribute(event.attributes.responseId);
  if (responseId) {
    attributes["gen_ai.response.id"] = responseId;
  }

  const capabilityId = stringAttribute(event.attributes.capabilityId);
  if (capabilityId) {
    attributes["aicf.capability_id"] = capabilityId;
  }

  const policyStatus = stringAttribute(event.attributes.policyStatus);
  if (policyStatus) {
    attributes["aicf.policy.status"] = policyStatus;
  }

  const actionState = stringAttribute(event.attributes.actionState);
  if (actionState) {
    attributes["aicf.action.state"] = actionState;
  }

  if (event.type.startsWith("model.call")) {
    attributes["gen_ai.provider.name"] = "openai";
    attributes["gen_ai.operation.name"] = "chat";
    attributes["gen_ai.request.stream"] = false;
  }

  if (event.type.startsWith("tool.execution")) {
    attributes["gen_ai.operation.name"] = "execute_tool";
  }

  return attributes;
}

function resolveTracer(api: unknown, tracerName: string): OpenTelemetryTraceSink["tracer"] {
  if (!isRecord(api)) {
    return null;
  }

  if (isRecord(api.trace) && typeof api.trace.getTracer === "function") {
    return api.trace.getTracer(tracerName) as OpenTelemetryTraceSink["tracer"];
  }

  if (typeof api.getTracer === "function") {
    return api.getTracer(tracerName) as OpenTelemetryTraceSink["tracer"];
  }

  if (typeof api.startSpan === "function") {
    return api as OpenTelemetryTraceSink["tracer"];
  }

  return null;
}

function spanName(event: AicfRuntimeTraceEvent): string {
  if (event.type.startsWith("model.call")) {
    return `chat ${stringAttribute(event.attributes.model) ?? "unknown"}`;
  }

  if (event.type.startsWith("tool.execution")) {
    return `execute_tool ${stringAttribute(event.attributes.capabilityId) ?? "unknown"}`;
  }

  return event.type;
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
