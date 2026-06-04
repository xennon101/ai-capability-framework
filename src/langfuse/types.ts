import type { AicfRuntimeTraceEvent, AicfTraceContentCapture, AicfTraceSinkDiagnostic } from "../observability/index.js";
import type { EvalCase, LoadedEvalCase } from "../types.js";

export interface AicfLangfuseTraceSinkOptions {
  client: unknown;
  contentCapture?: AicfTraceContentCapture;
}

export interface LangfuseDatasetExportItem {
  expectedOutput?: Record<string, unknown>;
  id: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface LangfuseTraceSinkLike {
  diagnostics: AicfTraceSinkDiagnostic[];
  emit(event: AicfRuntimeTraceEvent): Promise<void> | void;
  flush(): Promise<void>;
}

export type EvalCaseLike = EvalCase | LoadedEvalCase;
