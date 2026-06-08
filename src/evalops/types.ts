import type { AicfLiveEvalResult } from "../evals-live/index.js";
import type { EvalCase } from "../types.js";

export interface AicfEvalOpsExporter<TDataset = unknown, TResult = unknown> {
  exportDataset(evalCases: EvalCase[]): TDataset;
  importResults(input: unknown): TResult;
}

export interface BraintrustDatasetItem {
  expected?: Record<string, unknown>;
  id: string;
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface BraintrustDatasetExport {
  items: BraintrustDatasetItem[];
  schemaVersion: "1.0";
  source: "aicf";
}

export interface OpenAIEvalDatasetItem {
  expected?: Record<string, unknown>;
  id: string;
  input: Array<{ content: string; role: "user" }>;
  metadata: Record<string, unknown>;
}

export interface OpenAIEvalDatasetExport {
  data: OpenAIEvalDatasetItem[];
  schemaVersion: "1.0";
  source: "aicf";
}

export type EvalOpsImportedResult = AicfLiveEvalResult;

export interface EvalOpsImportInput {
  json: unknown;
}
