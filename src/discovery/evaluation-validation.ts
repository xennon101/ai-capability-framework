import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import type { ValidateFunction } from "ajv";
import type { DiscoveryEvaluationObservations, DiscoveryEvaluationSuite } from "../generated/manifest-types.js";
import { boundedJsonSnapshot } from "../runtime/bounded-json.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../schemas/${name}.schema.json`, import.meta.url), "utf8"));
ajv.addSchema(read("capability-manifest"));
const suiteValidator = ajv.compile(read("discovery/eval-suite"));
const observationsValidator = ajv.compile(read("discovery/eval-observations"));

export interface DiscoveryEvaluationDiagnostic { code: string; caseId?: string; }

function snapshot<T>(value: unknown, validate: ValidateFunction): T | null {
  try {
    const detached = boundedJsonSnapshot(value, 16 * 1024 * 1024);
    return validate(detached) ? detached as T : null;
  } catch { return null; }
}

export const evaluationSuiteSnapshot = (value: unknown) => snapshot<DiscoveryEvaluationSuite>(value, suiteValidator);
export const evaluationObservationsSnapshot = (value: unknown) => snapshot<DiscoveryEvaluationObservations>(value, observationsValidator);
