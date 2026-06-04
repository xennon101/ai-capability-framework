import type { EvalCase, JsonObject, LoadedEvalCase } from "../types.js";
import type { EvalCaseLike, LangfuseDatasetExportItem } from "./types.js";

export function createLangfuseDatasetItemsFromEvalCases(
  evalCases: EvalCaseLike[]
): LangfuseDatasetExportItem[] {
  return evalCases.map((evalCase) => {
    const manifest = unwrapEvalCase(evalCase);
    return {
      expectedOutput: {
        expected: manifest.expected,
        scorers: manifest.scorers
      },
      id: manifest.id,
      input: {
        user_message: manifest.input.user_message
      },
      metadata: {
        capability_under_test: manifest.capability_under_test,
        name: manifest.name,
        schema_version: manifest.schema_version,
        tags: manifest.tags ?? []
      }
    };
  });
}

export function createEvalCaseFromLangfuseDatasetItem(
  item: LangfuseDatasetExportItem
): EvalCase {
  const expected = isRecord(item.expectedOutput?.expected)
    ? item.expectedOutput.expected as EvalCase["expected"]
    : {
      response: {
        must_not_include: ["private_diagnostics", "provider payload", "raw prompt"]
      }
    };
  const scorers = Array.isArray(item.expectedOutput?.scorers) && item.expectedOutput.scorers.length > 0
    ? item.expectedOutput.scorers as EvalCase["scorers"]
    : [{ type: "response_excludes_private_detail" }] satisfies EvalCase["scorers"];

  return {
    expected,
    id: sanitizeEvalId(item.id),
    input: {
      user_message: stringValue(item.input.user_message) ?? stringValue(item.input.text) ?? "Synthetic eval input."
    },
    name: stringValue(item.metadata?.name),
    schema_version: "1.0",
    scorers
  };
}

function unwrapEvalCase(evalCase: EvalCaseLike): EvalCase {
  return "manifest" in evalCase ? (evalCase as LoadedEvalCase).manifest : evalCase as EvalCase;
}

function sanitizeEvalId(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[^a-z]+/, "eval_")
    .replace(/[._]+$/g, "");

  return sanitized.length > 0 ? sanitized : "eval_from_langfuse";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
