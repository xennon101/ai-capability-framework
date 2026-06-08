import type { EvalSuiteResult, JsonValue, ManifestRegistry, RiskTier } from "../types.js";
import type { GovernanceGateReport, RiskCompilationResult } from "../governance/index.js";
import type { ProviderConformanceReport } from "../conformance/index.js";
import type { SecurityPackCoverageReport } from "../security-packs/index.js";
import type { ControlPlaneEvidenceExport } from "../control-plane/index.js";

export type EvidenceExportFormat = "json" | "markdown";

export type EvidenceCoverageStatus = "available" | "gap" | "not_supplied";

export interface EvidenceProjectRef {
  environment?: string;
  id: string;
  name: string;
}

export interface EvidenceCoverageGap {
  code: string;
  message: string;
  severity: "info" | "warning" | "blocking";
  source: string;
}

export interface EvidenceDisclaimer {
  code: string;
  text: string;
}

export interface CapabilityInventoryItem {
  autonomyTier: string;
  capabilityType: string;
  domain?: string;
  id: string;
  lifecycle: {
    commit?: boolean;
    prepare?: boolean;
    read?: boolean;
    select?: boolean;
    verify?: boolean;
  };
  name: string;
  riskTier: RiskTier;
  status: string;
  version: string;
}

export interface RiskInventoryItem {
  capabilityId: string;
  declaredRiskTier: RiskTier;
  inferredRiskTier: RiskTier;
  passed: boolean;
  requiredControls: string[];
  warnings: string[];
}

export interface ProviderInventoryItem {
  label: string;
  provider: string;
  status: EvidenceCoverageStatus;
}

export interface PolicyInventoryItem {
  approvalRequired: boolean;
  auditRequired: boolean;
  capabilityId: string;
  idempotencyRequired: boolean;
  permissions: string[];
  policyRules: string[];
}

export interface EvidenceCountSummary {
  failed?: number;
  gaps?: number;
  passed?: number;
  total: number;
  warnings?: number;
}

export interface EvidenceEvalSummary extends EvidenceCountSummary {
  status: EvidenceCoverageStatus;
}

export interface EvidenceSecuritySummary extends EvidenceCountSummary {
  missingRequired: number;
  status: EvidenceCoverageStatus;
}

export interface EvidenceConformanceSummary extends EvidenceCountSummary {
  providers: number;
  status: EvidenceCoverageStatus;
}

export interface EvidenceApprovalSummary {
  approved: number;
  pending: number;
  rejected: number;
  status: EvidenceCoverageStatus;
  total: number;
}

export interface EvidenceIncidentSummary {
  open: number;
  resolved: number;
  status: EvidenceCoverageStatus;
  total: number;
}

export interface EvidenceRetentionSummary {
  auditRecordRetentionDays?: number;
  evalDatasetRetentionDays?: number;
  rawPromptRetention: "none" | "short_diagnostic" | "custom";
  rawProviderPayloadRetention: "none" | "short_diagnostic" | "custom";
  status: EvidenceCoverageStatus;
  traceMetadataRetentionDays?: number;
}

export interface HumanReviewPolicySummary {
  approvalRequiredCapabilities: number;
  humanReviewRequiredCapabilities: number;
  status: EvidenceCoverageStatus;
}

export interface ModelUpgradeRecord {
  changedAt: string;
  fromModel?: string;
  reason: string;
  toModel: string;
}

export interface EvidenceRiskMapping {
  category: string;
  control: string;
  framework: "aicf" | "nist_ai_rmf" | "owasp_llm_top_10" | "custom";
}

export interface EvidencePack {
  aicfVersion: string;
  approvalSummary: EvidenceApprovalSummary;
  capabilityInventory: CapabilityInventoryItem[];
  conformanceSummary: EvidenceConformanceSummary;
  disclaimers: EvidenceDisclaimer[];
  evalSummary: EvidenceEvalSummary;
  gaps: EvidenceCoverageGap[];
  generatedAt: string;
  humanReviewPolicySummary: HumanReviewPolicySummary;
  incidentSummary?: EvidenceIncidentSummary;
  mappings: EvidenceRiskMapping[];
  modelUpgradeHistory?: ModelUpgradeRecord[];
  policyInventory: PolicyInventoryItem[];
  project: EvidenceProjectRef;
  providerInventory: ProviderInventoryItem[];
  redaction: {
    content: "redacted_refs_and_hashes_only";
    omitted: string[];
  };
  retentionSummary: EvidenceRetentionSummary;
  riskInventory: RiskInventoryItem[];
  schemaVersion: "1.0";
  securitySummary: EvidenceSecuritySummary;
}

export interface EvidenceIncidentSummaryInput {
  open?: number;
  resolved?: number;
  total?: number;
}

export interface EvidenceExportInput {
  aicfVersion?: string;
  conformanceReport?: ProviderConformanceReport;
  controlPlaneEvidence?: ControlPlaneEvidenceExport;
  environment?: string;
  evalSuiteResult?: EvalSuiteResult;
  generatedAt?: string;
  gateReport?: GovernanceGateReport;
  incidentSummary?: EvidenceIncidentSummaryInput;
  modelUpgradeHistory?: ModelUpgradeRecord[];
  project?: Partial<EvidenceProjectRef>;
  registry: ManifestRegistry;
  riskResults?: RiskCompilationResult[];
  securityReport?: SecurityPackCoverageReport;
}

export interface EvidenceExportResult {
  content: string;
  format: EvidenceExportFormat;
  pack: EvidencePack;
}

export interface EvidenceValidationResult {
  errors: string[];
  valid: boolean;
}

export type EvidenceJsonValue = JsonValue;
