import type { EvalCase } from "../types.js";
import type { AicfLiveEvalResult } from "../evals-live/index.js";

export interface PromptfooExportOptions {
  ciCommand?: string;
  evalCases: EvalCase[];
  includeRedTeamDefaults?: boolean;
  outputPath?: string;
  providerName?: string;
  providerTargets?: Array<{
    id: string;
    label?: string;
  }>;
  targetUrlPlaceholder?: string;
}

export interface PromptfooExportResult {
  files: Array<{
    content: string;
    path: string;
  }>;
}

export interface PromptfooImportResultsInput {
  json: unknown;
}

export type PromptfooImportedResult = AicfLiveEvalResult;
