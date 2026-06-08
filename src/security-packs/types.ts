import type { CapabilityManifest, EvalCase, ManifestRegistry, RiskTier } from "../types.js";

export type SecurityPackId =
  | "prompt_injection_direct"
  | "prompt_injection_indirect"
  | "tool_exfiltration"
  | "cross_tenant_access"
  | "approval_bypass"
  | "unsafe_commit_attempt"
  | "schema_confusion"
  | "capability_spoofing"
  | "tool_result_poisoning"
  | "sensitive_data_disclosure"
  | "insecure_output_rendering"
  | "cost_amplification"
  | "provider_payload_exposure"
  | "mcp_tool_abuse"
  | "retrieval_poisoning"
  | "memory_scope_violation";

export type CapabilityType = CapabilityManifest["capability_type"];
export type CapabilityRiskTier = RiskTier;

export interface RiskMapping {
  category: string;
  description: string;
  framework: "aicf" | "nist_ai_rmf" | "owasp_llm_top_10";
}

export interface RequiredSecurityControl {
  code: string;
  description: string;
  required: boolean;
}

export interface SecurityCaseTemplate {
  expected: EvalCase["expected"];
  id: string;
  name: string;
  tags: string[];
  userMessageTemplate: string;
}

export interface SecurityPack {
  applicableCapabilityTypes: CapabilityType[];
  cases: SecurityCaseTemplate[];
  description: string;
  expectedControls: RequiredSecurityControl[];
  id: SecurityPackId;
  mappedRisks: RiskMapping[];
  minimumRiskTiers: CapabilityRiskTier[];
  name: string;
  schema_version: "1.0";
}

export interface GeneratedSecurityCase {
  capabilityId: string;
  capabilityType: CapabilityType;
  expected: EvalCase["expected"];
  id: string;
  name: string;
  packId: SecurityPackId;
  riskTier: CapabilityRiskTier;
  tags: string[];
  userMessage: string;
}

export interface SecurityCaseSuite {
  cases: GeneratedSecurityCase[];
  generatedAt: string;
  schema_version: "1.0";
}

export interface SecurityPackWaiver {
  pack_id: SecurityPackId | string;
  reason: string;
  reviewed_at: string;
  reviewer: string;
}

export interface SecurityPackCoverageItem {
  assignedPacks: string[];
  capabilityId: string;
  missingRequiredPacks: SecurityPackId[];
  recommendedPacks: SecurityPackId[];
  requiredPacks: SecurityPackId[];
  riskTier: CapabilityRiskTier;
  validWaivers: SecurityPackWaiver[];
  warnings: string[];
}

export interface SecurityPackCoverageReport {
  capabilities: SecurityPackCoverageItem[];
  generatedAt: string;
  missingRequired: number;
  passed: boolean;
  schema_version: "1.0";
}

export interface GenerateSecurityCasesOptions {
  capabilityIds?: string[];
  generatedAt?: string;
  packIds?: SecurityPackId[];
}

export interface AssessSecurityPackCoverageOptions {
  capabilityIds?: string[];
  generatedAt?: string;
  generatedPackIds?: SecurityPackId[];
}

export interface PromptfooRedTeamConfig {
  description: string;
  prompts: string[];
  providers: string[];
  tests: Array<{
    assert: Array<Record<string, unknown>>;
    description: string;
    vars: Record<string, unknown>;
  }>;
}

export interface PromptfooSecurityPackExportOptions extends GenerateSecurityCasesOptions {
  outputPath?: string;
  providerName?: string;
  targetUrl?: string;
}

export interface PromptfooSecurityPackExportResult {
  cases: GeneratedSecurityCase[];
  config: PromptfooRedTeamConfig;
  files: Array<{
    content: string;
    path: string;
  }>;
}

export interface SecurityPackGenerationInput {
  options?: GenerateSecurityCasesOptions;
  registry: ManifestRegistry;
}
