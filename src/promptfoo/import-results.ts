import type { AicfLiveEvalResult } from "../evals-live/index.js";
import type { PromptfooImportResultsInput } from "./types.js";

export function importPromptfooResults(
  input: PromptfooImportResultsInput
): AicfLiveEvalResult[] {
  const rows = resultRows(input.json);
  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {};
    const vars = firstRecord(record.vars, record.testCase, record.test) ?? {};
    const evalId = stringValue(vars.aicf_eval_id)
      ?? stringValue(vars.eval_id)
      ?? stringValue(record.description)
      ?? `promptfoo.result.${index + 1}`;
    const passed = booleanValue(record.success)
      ?? booleanValue(record.passed)
      ?? stringValue(record.status) === "success";
    const output = stringValue(record.output)
      ?? stringValue(record.response)
      ?? stringValue(record.result);

    return {
      candidate: {
        eval_id: evalId,
        response: output ? { text: output } : undefined
      },
      evalId,
      scores: [{
        message: passed ? "Promptfoo result passed." : "Promptfoo result failed.",
        passed,
        score: passed ? 1 : 0,
        scorer: "promptfoo_result"
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
    if (Array.isArray(value.prompts)) return value.prompts;
    if (isRecord(value.table) && Array.isArray(value.table.body)) return value.table.body;
  }

  return [];
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }

    if (isRecord(value.vars)) return value.vars;
    return value;
  }

  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
