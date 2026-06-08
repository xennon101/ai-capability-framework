import type {
  AicfDiagnostic,
  CapabilityManifest,
  EntityManifest,
  ManifestRegistry,
  RiskTier,
  ValidationResult
} from "../types.js";
import type {
  CanonicalProviderConformanceTarget,
  ProviderConformanceReport,
  ProviderConformanceTargetAlias
} from "../providers/conformance/index.js";

export type CapabilityLifecycleStatus =
  | "draft"
  | "review"
  | "approved"
  | "canary"
  | "production"
  | "deprecated"
  | "disabled"
  | "removed";

export type GovernanceSeverity = "info" | "warning" | "blocking";

export interface GovernanceReason {
  code: string;
  message: string;
  severity: GovernanceSeverity;
}

export interface GovernanceRequirement {
  code: string;
  message: string;
  severity: GovernanceSeverity;
}

export interface GovernanceActor {
  displayName?: string;
  id?: string;
  type?: "user" | "service" | "system";
}

export interface GovernanceEvidenceRef {
  description?: string;
  id?: string;
  kind?: string;
  uri?: string;
}

export interface GovernanceOverride {
  approvedBy?: string;
  emergency?: boolean;
  reason?: string;
}

export interface GovernanceContext {
  activeCircuitBreakers?: string[];
  activeKillSwitches?: string[];
  deterministicEvalsPassed?: boolean;
  evalGatePassed?: boolean;
  migrationNotes?: string;
  replacementCapabilityId?: string;
  requiredSecurityPacks?: string[];
  satisfiedSecurityPacks?: string[];
  strict?: boolean;
  validation?: ValidationResult;
}

export interface LifecycleTransitionRequest {
  actor?: GovernanceActor;
  capabilityId: string;
  evidence?: GovernanceEvidenceRef[];
  from?: CapabilityLifecycleStatus;
  override?: GovernanceOverride;
  reason: string;
  to: CapabilityLifecycleStatus;
}

export interface LifecycleTransitionDecision {
  allowed: boolean;
  from: CapabilityLifecycleStatus;
  reasons: GovernanceReason[];
  requiredActions: GovernanceRequirement[];
  to: CapabilityLifecycleStatus;
  warnings: GovernanceReason[];
}

export type RequiredControlCode =
  | "approval_required"
  | "idempotency_required"
  | "audit_required"
  | "commit_not_model_exposed"
  | "redaction_required"
  | "retention_policy_required"
  | "security_pack_required"
  | "human_review_required";

export interface RequiredControl {
  code: RequiredControlCode;
  message: string;
  present: boolean;
  required: boolean;
}

export interface RiskCompilationOptions {
  entities?: EntityManifest[];
}

export interface RiskCompilationResult {
  capabilityId: string;
  declaredRiskTier: RiskTier;
  inferredMinimumRiskTier: RiskTier;
  passed: boolean;
  reasons: GovernanceReason[];
  requiredControls: RequiredControl[];
  warnings: GovernanceReason[];
}

export type CompatibilityLevel = "compatible" | "requires_minor" | "breaking";

export interface CompatibilityChange {
  code: string;
  compatibility: CompatibilityLevel;
  message: string;
  path?: string;
}

export interface CompatibilityDiff {
  capabilityId: string;
  changes: CompatibilityChange[];
  compatibility: CompatibilityLevel;
  fromVersion: string;
  requiredActions: GovernanceRequirement[];
  toVersion: string;
}

export interface ImpactCoverageGap {
  code: string;
  message: string;
  severity: GovernanceSeverity;
}

export interface ImpactAnalysisOptions {
  affectedTenants?: string[];
  affectedTraces?: string[];
}

export interface CapabilityImpactReport {
  affectedCapabilities: string[];
  affectedEntities: string[];
  affectedEvalSuites: string[];
  affectedPolicies: string[];
  affectedProviders: string[];
  affectedSecurityPacks: string[];
  affectedTenants?: string[];
  affectedTraces?: string[];
  capabilityId: string;
  missingCoverage: ImpactCoverageGap[];
}

export interface GovernanceLoadedRegistry {
  registry: ManifestRegistry;
}

export interface GovernanceCapabilityInput {
  capability: CapabilityManifest;
}

export type GovernanceGateCheckStatus = "passed" | "failed" | "warning" | "skipped";

export type GovernanceGateExitCode = 0 | 1 | 2 | 3 | 4 | 5;

export interface GovernanceGateEnvironmentConfig {
  artifact_hygiene?: boolean;
  block_deprecated_capabilities?: boolean;
  fail_on_warnings?: boolean;
  require_conformance_for_enabled_providers?: boolean;
  require_evals_for?: RiskTier[];
  require_security_packs_for?: RiskTier[];
}

export interface GovernanceGateConfig {
  compatibility?: {
    baseline_root?: string;
  };
  gates?: Record<string, GovernanceGateEnvironmentConfig>;
  project?: {
    environment?: string;
    name?: string;
  };
  providers?: {
    enabled?: Array<CanonicalProviderConformanceTarget | ProviderConformanceTargetAlias>;
    server_url?: string;
  };
  runtime?: {
    default_autonomy_tier?: "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
    max_tool_calls_per_run?: number;
  };
  schema_version: "1.0";
}

export interface LoadGovernanceGateConfigOptions {
  configPath?: string;
  environment?: string;
}

export interface LoadGovernanceGateConfigResult {
  config: GovernanceGateConfig;
  diagnostics: AicfDiagnostic[];
  path?: string;
}

export interface GovernanceGateCheck {
  details?: unknown;
  failures: string[];
  id: string;
  name: string;
  status: GovernanceGateCheckStatus;
  summary: string;
  warnings: string[];
}

export interface GovernanceGateReport {
  checks: GovernanceGateCheck[];
  configPath?: string;
  environment: string;
  exitCode: GovernanceGateExitCode;
  failures: string[];
  generatedAt: string;
  manifestRoot: string;
  passed: boolean;
  schema_version: "1.0";
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    warnings: number;
  };
  warnings: string[];
}

export interface RunGovernanceGateInput {
  baselineRoot?: string;
  config?: GovernanceGateConfig;
  configPath?: string;
  environment?: string;
  failOnWarnings?: boolean;
  generatedAt?: string;
  includeArtifactHygiene?: boolean;
  manifestRoot: string;
}

export interface GovernanceGateSettings {
  artifactHygiene: boolean;
  blockDeprecatedCapabilities: boolean;
  failOnWarnings: boolean;
  requireConformanceForEnabledProviders: boolean;
  requireEvalsFor: RiskTier[];
  requireSecurityPacksFor: RiskTier[];
}

export interface GovernanceGateLoadedState {
  conformance?: ProviderConformanceReport;
}
