import { TraceSinkTracer } from "../observability/index.js";
import { LangfuseTraceSink } from "./trace-sink.js";
import type { AicfLangfuseTraceSinkOptions, LangfuseDatasetExportItem, LangfuseTraceReference } from "./types.js";

export class LangfuseTracerAdapter extends TraceSinkTracer {
  readonly langfuseSink: LangfuseTraceSink;

  constructor(options: AicfLangfuseTraceSinkOptions) {
    const sink = new LangfuseTraceSink(options);
    super(sink, { contentCapture: options.contentCapture });
    this.langfuseSink = sink;
  }

  flush(): Promise<void> {
    return this.langfuseSink.flush();
  }
}

export async function publishLangfuseDatasetItems(
  client: unknown,
  items: LangfuseDatasetExportItem[]
): Promise<void> {
  if (!isRecord(client)) {
    return;
  }
  const method = firstMethod(client, ["datasetItem", "createDatasetItem", "createDatasetItems"]);
  if (!method) {
    return;
  }
  for (const item of items) {
    await method.call(client, sanitizeDatasetItem(item));
  }
}

export function createLangfuseTraceReference(input: {
  aicfRunId: string;
  aicfTraceId?: string;
  langfuseTraceId: string;
}): LangfuseTraceReference {
  return {
    aicfRunId: input.aicfRunId,
    aicfTraceId: input.aicfTraceId,
    langfuseTraceId: input.langfuseTraceId,
    source: "aicf_trace_to_golden"
  };
}

function sanitizeDatasetItem(item: LangfuseDatasetExportItem): LangfuseDatasetExportItem {
  return JSON.parse(JSON.stringify(item).replace(/rawProviderPayload|rawPrompt|private_diagnostics|secret|token/gi, "[REDACTED]")) as LangfuseDatasetExportItem;
}

function firstMethod(client: Record<string, unknown>, names: string[]): Function | undefined {
  for (const name of names) {
    if (typeof client[name] === "function") {
      return client[name] as Function;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
