import { sanitizeTraceEvent, type AicfRuntimeTraceEvent, type AicfTraceSink, type AicfTraceSinkDiagnostic } from "../observability/index.js";
import type { AicfLangfuseTraceSinkOptions } from "./types.js";

export class LangfuseTraceSink implements AicfTraceSink {
  readonly diagnostics: AicfTraceSinkDiagnostic[] = [];
  private client: unknown;
  private contentCapture: AicfLangfuseTraceSinkOptions["contentCapture"];

  constructor(options: AicfLangfuseTraceSinkOptions) {
    this.client = options.client;
    this.contentCapture = options.contentCapture ?? "metadata";
    if (!isRecord(this.client)) {
      this.diagnostics.push({
        code: "langfuse_client_invalid",
        message: "Langfuse client was not an object."
      });
    }
  }

  async emit(event: AicfRuntimeTraceEvent): Promise<void> {
    if (!isRecord(this.client)) {
      return;
    }

    const sanitized = sanitizeTraceEvent(event, {
      contentCapture: this.contentCapture
    });
    const payload = {
      id: `${sanitized.runId}:${sanitized.requestId}`,
      metadata: {
        ...sanitized.attributes,
        aicf_event_type: sanitized.type,
        aicf_request_id: sanitized.requestId,
        aicf_run_id: sanitized.runId
      },
      name: "aicf-runtime",
      timestamp: sanitized.timestamp
    };

    await this.callOptional(["trace", "startTrace", "recordTrace"], payload);
    await this.callOptional(["observation", "span", "generation"], {
      ...payload,
      name: sanitized.type
    });

    if (sanitized.type === "eval.score") {
      await this.callOptional(["score", "createScore"], {
        name: String(sanitized.attributes.scorer ?? "aicf_eval"),
        traceId: payload.id,
        value: typeof sanitized.attributes.score === "number" ? sanitized.attributes.score : undefined
      });
    }
  }

  async flush(): Promise<void> {
    await this.callOptional(["flush"]);
  }

  private async callOptional(methodNames: string[], payload?: unknown): Promise<void> {
    if (!isRecord(this.client)) {
      return;
    }

    for (const methodName of methodNames) {
      const method = this.client[methodName];
      if (typeof method !== "function") {
        continue;
      }

      try {
        await method.call(this.client, payload);
      } catch {
        this.diagnostics.push({
          code: "langfuse_method_failed",
          message: `Langfuse client method "${methodName}" failed.`,
          sink: "LangfuseTraceSink"
        });
      }
      return;
    }

    this.diagnostics.push({
      code: "langfuse_method_missing",
      message: `Langfuse client did not expose any of: ${methodNames.join(", ")}.`,
      sink: "LangfuseTraceSink"
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
