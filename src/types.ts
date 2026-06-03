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

export type AutonomyTier = "A0" | "A1" | "A2" | "A3" | "A4" | "A5";

export type DecisionOperation = "select" | "prepare" | "commit";

export type DecisionStatus = "allowed" | "approval_required" | "denied";

export type DecisionReasonCode =
  | "approval_required"
  | "autonomy_exceeded"
  | "capability_not_found"
  | "deny_rule_matched"
  | "idempotency_required"
  | "lifecycle_not_supported"
  | "missing_fact"
  | "missing_permission";

export interface DecisionReason {
  code: DecisionReasonCode;
  message: string;
  rule?: string;
}

export type DecisionFact = boolean | {
  reason?: string;
  value: boolean;
};

export interface DecisionRequest {
  args?: Record<string, unknown>;
  approval?: {
    approvalId?: string;
    approved: boolean;
  };
  capabilityId: string;
  context: {
    autonomyTier: AutonomyTier;
    permissions: string[];
    tenantId?: string;
    userId?: string;
  };
  facts?: Record<string, DecisionFact>;
  idempotencyKey?: string;
  operation: DecisionOperation;
}

export interface DecisionAuditPreview {
  capabilityId: string;
  idempotencyKey?: string;
  operation: DecisionOperation;
  reasons: DecisionReason[];
  status: DecisionStatus;
}

export interface DecisionResult {
  audit: DecisionAuditPreview;
  capabilityId: string;
  diagnostics: AicfDiagnostic[];
  lifecycle: LifecycleEvaluation;
  operation: DecisionOperation;
  policy: PolicyEvaluation;
  reasons: DecisionReason[];
  requiredApprovals: DecisionReason[];
  status: DecisionStatus;
}

export interface PolicyEvaluation {
  reasons: DecisionReason[];
  requiredApprovals: DecisionReason[];
  status: DecisionStatus;
}

export interface LifecycleEvaluation {
  reasons: DecisionReason[];
  status: DecisionStatus;
}
