import type { EvalCase } from "../types.js";
import type {
  BraintrustDatasetExport,
  BraintrustDatasetItem,
  EvalOpsImportedResult,
  EvalOpsImportInput,
  OpenAIEvalDatasetExport,
  OpenAIEvalDatasetItem
} from "./types.js";

export function exportBraintrustDataset(evalCases: EvalCase[]): BraintrustDatasetExport {
  return {
    items: evalCases.map(braintrustItem),
    schemaVersion: "1.0",
    source: "aicf"
  };
}

export function exportOpenAIEvalDataset(evalCases: EvalCase[]): OpenAIEvalDatasetExport {
  return {
    data: evalCases.map(openAiItem),
    schemaVersion: "1.0",
    source: "aicf"
  };
}

export function importBraintrustResults(input: EvalOpsImportInput): EvalOpsImportedResult[] {
  return importGenericResults(input.json, "braintrust_result");
}

export function importOpenAIEvalResults(input: EvalOpsImportInput): EvalOpsImportedResult[] {
  return importGenericResults(input.json, "openai_eval_result");
}

function braintrustItem(evalCase: EvalCase): BraintrustDatasetItem {
  return sanitizeObject({
    expected: evalCase.expected,
    id: evalCase.id,
    input: {
      user_message: evalCase.input.user_message
    },
    metadata: metadataForEval(evalCase)
  }) as BraintrustDatasetItem;
}

function openAiItem(evalCase: EvalCase): OpenAIEvalDatasetItem {
  return sanitizeObject({
    expected: evalCase.expected,
    id: evalCase.id,
    input: [{
      content: evalCase.input.user_message,
      role: "user"
    }],
    metadata: metadataForEval(evalCase)
  }) as OpenAIEvalDatasetItem;
}

function metadataForEval(evalCase: EvalCase): Record<string, unknown> {
  return {
    aicf_eval_id: evalCase.id,
    capability_under_test: evalCase.capability_under_test,
    schema_version: evalCase.schema_version,
    scorers: evalCase.scorers.map((scorer) => scorer.type),
    tags: evalCase.tags ?? []
  };
}

function importGenericResults(value: unknown, scorer: string): EvalOpsImportedResult[] {
  return resultRows(value).map((row, index) => {
    const record = isRecord(row) ? row : {};
    const evalId = stringValue(record.eval_id)
      ?? stringValue(record.evalId)
      ?? stringValue(record.id)
      ?? stringValue(record.testId)
      ?? `evalops.result.${index + 1}`;
    const passed = booleanValue(record.passed)
      ?? booleanValue(record.success)
      ?? stringValue(record.status) === "passed";
    const score = numberValue(record.score) ?? (passed ? 1 : 0);
    const output = stringValue(record.output)
      ?? stringValue(record.response)
      ?? stringValue(record.result);

    return {
      candidate: {
        eval_id: evalId,
        response: output ? { text: sanitizeText(output) } : undefined
      },
      evalId,
      scores: [{
        message: passed ? "Imported EvalOps result passed." : "Imported EvalOps result failed.",
        passed,
        score,
        scorer
      }],
      status: passed ? "passed" : "failed"
    };
  });
}

function resultRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    if (Array.isArray(value.results)) return value.results;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.data)) return value.data;
  }
  return [];
}

const unsafeKeyPattern = /rawPrompt|rawProviderPayload|rawTrace|private_diagnostics|secret|token|apiKey/i;

function sanitizeObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeObject);
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (unsafeKeyPattern.test(key)) {
        continue;
      }
      output[key] = sanitizeObject(child);
    }
    return output;
  }
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  return value;
}

function sanitizeText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
