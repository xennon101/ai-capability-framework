import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AicfDiagnostic } from "../types.js";
import type { ReplayTrace, ValidateReplayTraceResult } from "./types.js";

const schemaDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas/replay");
const ajv = new Ajv2020({ allErrors: true, strict: false });
const replayTraceValidator = compileSchema("replay-trace.schema.json");
const forbiddenRawKeys = new Set([
  "private_diagnostics",
  "providerPayload",
  "provider_payload",
  "rawPrompt",
  "rawProviderPayload",
  "rawTrace",
  "raw_provider_payload",
  "raw_prompt",
  "raw_trace"
]);

export function validateReplayTrace(trace: unknown, tracePath = "replay-trace"): ValidateReplayTraceResult {
  const diagnostics: AicfDiagnostic[] = [];
  const valid = replayTraceValidator(trace);

  if (!valid) {
    diagnostics.push(...(replayTraceValidator.errors ?? []).map((error) => ({
      code: "schema" as const,
      details: error,
      message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`,
      path: tracePath
    })));
  }

  diagnostics.push(...scanForRawFields(trace, tracePath));

  return {
    diagnostics,
    valid: diagnostics.length === 0
  };
}

export function assertReplayTrace(trace: unknown, tracePath = "replay-trace"): trace is ReplayTrace {
  return validateReplayTrace(trace, tracePath).valid;
}

function compileSchema(fileName: string): ValidateFunction {
  return ajv.compile(JSON.parse(readFileSync(path.join(schemaDirectory, fileName), "utf8")) as Record<string, unknown>);
}

function scanForRawFields(value: unknown, tracePath: string, currentPath = "$"): AicfDiagnostic[] {
  const diagnostics: AicfDiagnostic[] = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      diagnostics.push(...scanForRawFields(entry, tracePath, `${currentPath}[${index}]`));
    });
    return diagnostics;
  }

  if (!isRecord(value)) {
    return diagnostics;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${currentPath}.${key}`;
    if (forbiddenRawKeys.has(key)) {
      diagnostics.push({
        code: "invalid_replay_trace",
        message: `Replay traces must not include raw prompt, raw provider payload, raw trace, or private diagnostic field "${key}".`,
        path: `${tracePath}:${childPath}`
      });
    }
    diagnostics.push(...scanForRawFields(child, tracePath, childPath));
  }

  return diagnostics;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
