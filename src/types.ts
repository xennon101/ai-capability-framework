import type { ErrorObject } from "ajv";
import type {
  CapabilityManifest,
  EntityManifest,
  EvalCase
} from "./generated/manifest-types.js";

export type {
  CapabilityManifest,
  EntityManifest,
  EvalCase
} from "./generated/manifest-types.js";

export type ManifestKind = "capability" | "entity" | "eval";

export type AicfErrorCode =
  | "duplicate_id"
  | "missing_reference"
  | "parse"
  | "schema"
  | "unsupported";

export type AicfWarningCode =
  | "unknown_allowed_action"
  | "unknown_capability_under_test";

export interface AicfDiagnostic {
  code: AicfErrorCode | AicfWarningCode;
  path: string;
  kind?: ManifestKind;
  id?: string;
  message: string;
  details?: unknown;
}

export interface AicfSchemaDiagnostic extends AicfDiagnostic {
  code: "schema";
  details: ErrorObject;
}

export interface LoadedManifestBase<TManifest, TKind extends ManifestKind> {
  absolutePath: string;
  kind: TKind;
  manifest: TManifest;
  path: string;
}

export type LoadedCapabilityManifest = LoadedManifestBase<CapabilityManifest, "capability">;
export type LoadedEntityManifest = LoadedManifestBase<EntityManifest, "entity">;
export type LoadedEvalCase = LoadedManifestBase<EvalCase, "eval">;

export type LoadedManifest =
  | LoadedCapabilityManifest
  | LoadedEntityManifest
  | LoadedEvalCase;

export interface LoadManifestsOptions {
  path?: string;
  root?: string;
}

export interface LoadManifestsResult {
  basePath: string;
  errors: AicfDiagnostic[];
  manifests: LoadedManifest[];
  root: string;
}

export interface ValidationResult {
  errors: AicfDiagnostic[];
  valid: boolean;
}

export interface ValidateManifestsOptions {
  reserved?: never;
}

export interface ManifestRegistry {
  capabilities: LoadedCapabilityManifest[];
  capabilityById: Map<string, LoadedCapabilityManifest>;
  entities: LoadedEntityManifest[];
  entityById: Map<string, LoadedEntityManifest>;
  evalById: Map<string, LoadedEvalCase>;
  evals: LoadedEvalCase[];
  warnings: AicfDiagnostic[];
}

export interface RegistryInspection {
  capabilitiesByRisk: Record<string, string[]>;
  capabilitiesByType: Record<string, string[]>;
  counts: {
    capabilities: number;
    entities: number;
    evals: number;
    manifests: number;
  };
  entities: string[];
  evalCoverage: Array<{
    capabilityId: string;
    golden: number;
    redTeam: number;
  }>;
  warnings: AicfDiagnostic[];
}
