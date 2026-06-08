import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { listProviderTargets } from "../conformance/index.js";
import { compileCapabilityRisk } from "../governance/index.js";
import { defaultRetentionPolicy } from "../security/index.js";
import { assessSecurityPackCoverage } from "../security-packs/index.js";
import type { CapabilityManifest, EvalSuiteResult, ManifestRegistry } from "../types.js";
import type {
  CapabilityInventoryItem,
  EvidenceApprovalSummary,
  EvidenceConformanceSummary,
  EvidenceCoverageGap,
  EvidenceDisclaimer,
  EvidenceEvalSummary,
  EvidenceExportFormat,
  EvidenceExportInput,
  EvidenceExportResult,
  EvidenceIncidentSummary,
  EvidencePack,
  EvidenceRetentionSummary,
  EvidenceSecuritySummary,
  EvidenceValidationResult,
  HumanReviewPolicySummary,
  ModelUpgradeRecord,
  PolicyInventoryItem,
  ProviderInventoryItem,
  RiskInventoryItem
} from "./types.js";

const schemaDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false });
let evidencePackValidator: ValidateFunction | undefined;

export const evidencePackDisclaimerText = "This evidence pack summarizes AICF configuration and runtime/evaluation records supplied to the exporter. It is not a certification, audit opinion, legal opinion, security guarantee, or compliance attestation.";

const omittedEvidenceContent = [
  "raw prompts",
  "raw provider payloads",
  "raw transcripts",
  "secrets",
  "stack traces",
  "unredacted subject, account, and tenant identifiers",
  "sensitive tool output"
];

export function createEvidencePack(input: EvidenceExportInput): EvidencePack {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const riskResults = input.riskResults ?? input.registry.capabilities.map((entry) => compileCapabilityRisk(entry.manifest, {
    entities: input.registry.entities.map((entity) => entity.manifest)
  }));
  const securityReport = input.securityReport ?? assessSecurityPackCoverage(input.registry, { generatedAt });
  const gaps: EvidenceCoverageGap[] = [];
  const evalSummary = summarizeEvalCoverage(input.registry, input.evalSuiteResult, gaps);
  const securitySummary = summarizeSecurityCoverage(securityReport, gaps);
  const conformanceSummary = summarizeConformance(input.conformanceReport, gaps);
  const approvalSummary = summarizeApprovals(input.controlPlaneEvidence, gaps);
  const retentionSummary = summarizeRetention();
  const humanReviewPolicySummary = summarizeHumanReview(input.registry);

  const incidentSummary = input.incidentSummary
    ? summarizeIncident(input.incidentSummary)
    : undefined;

  if (!input.controlPlaneEvidence) {
    gaps.push(gap("runtime_records_not_supplied", "Runtime/control-plane action, decision, and approval records were not supplied to the evidence exporter.", "info", "runtime"));
  }

  const pack: EvidencePack = {
    aicfVersion: input.aicfVersion ?? "unknown",
    approvalSummary,
    capabilityInventory: summarizeCapabilities(input.registry),
    conformanceSummary,
    disclaimers: evidenceDisclaimers(),
    evalSummary,
    gaps,
    generatedAt,
    humanReviewPolicySummary,
    incidentSummary,
    mappings: summarizeRiskMappings(riskResults),
    modelUpgradeHistory: sanitizeModelUpgradeHistory(input.modelUpgradeHistory),
    policyInventory: summarizePolicies(input.registry),
    project: {
      environment: input.environment ?? input.gateReport?.environment ?? input.project?.environment,
      id: input.project?.id ?? input.gateReport?.manifestRoot ?? "aicf-project",
      name: input.project?.name ?? "AICF Project"
    },
    providerInventory: summarizeProviders(input.conformanceReport),
    redaction: {
      content: "redacted_refs_and_hashes_only",
      omitted: omittedEvidenceContent
    },
    retentionSummary,
    riskInventory: summarizeRisks(riskResults),
    schemaVersion: "1.0",
    securitySummary
  };

  if (!pack.modelUpgradeHistory || pack.modelUpgradeHistory.length === 0) {
    delete pack.modelUpgradeHistory;
  }

  return pack;
}

export function exportEvidencePack(input: EvidenceExportInput, format: EvidenceExportFormat = "json"): EvidenceExportResult {
  const pack = createEvidencePack(input);
  return {
    content: format === "markdown" ? formatEvidencePackMarkdown(pack) : `${JSON.stringify(pack, null, 2)}\n`,
    format,
    pack
  };
}

export function validateEvidencePack(pack: unknown): EvidenceValidationResult {
  const validator = getEvidencePackValidator();
  const valid = validator(pack);
  if (valid) {
    return {
      errors: [],
      valid: true
    };
  }

  return {
    errors: (validator.errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`),
    valid: false
  };
}

export function formatEvidencePackMarkdown(pack: EvidencePack): string {
  const lines = [
    `# ${pack.project.name} Evidence Pack`,
    "",
    `Generated: ${pack.generatedAt}`,
    `AICF version: ${pack.aicfVersion}`,
    pack.project.environment ? `Environment: ${pack.project.environment}` : undefined,
    "",
    "## Disclaimers",
    ...pack.disclaimers.map((disclaimer) => `- ${disclaimer.text}`),
    "",
    "## Summary",
    `- Capabilities: ${pack.capabilityInventory.length}`,
    `- Risk checks passed: ${pack.riskInventory.filter((item) => item.passed).length}/${pack.riskInventory.length}`,
    `- Evals: ${pack.evalSummary.status} (${pack.evalSummary.passed ?? 0}/${pack.evalSummary.total} passed)`,
    `- Security packs: ${pack.securitySummary.status} (${pack.securitySummary.missingRequired} missing required)`,
    `- Provider conformance: ${pack.conformanceSummary.status} (${pack.conformanceSummary.providers} provider targets)`,
    `- Approvals: ${pack.approvalSummary.status} (${pack.approvalSummary.total} records)`,
    "",
    "## Coverage Gaps",
    ...(pack.gaps.length === 0
      ? ["- No coverage gaps were reported by the supplied evidence."]
      : pack.gaps.map((gapItem) => `- ${gapItem.severity}: ${gapItem.code}: ${gapItem.message}`)),
    "",
    "## Capability Inventory",
    "| Capability | Version | Type | Risk | Status |",
    "| --- | --- | --- | --- | --- |",
    ...pack.capabilityInventory.map((item) => `| ${item.id} | ${item.version} | ${item.capabilityType} | ${item.riskTier} | ${item.status} |`),
    "",
    "## Risk Inventory",
    "| Capability | Declared | Inferred | Passed | Required Controls |",
    "| --- | --- | --- | --- | --- |",
    ...pack.riskInventory.map((item) => `| ${item.capabilityId} | ${item.declaredRiskTier} | ${item.inferredRiskTier} | ${item.passed ? "yes" : "no"} | ${item.requiredControls.join(", ") || "none"} |`),
    "",
    "## Redaction",
    `Content mode: ${pack.redaction.content}`,
    ...pack.redaction.omitted.map((item) => `- omitted: ${item}`),
    ""
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n")}\n`;
}

export function summarizeCapabilities(registry: ManifestRegistry): CapabilityInventoryItem[] {
  return registry.capabilities
    .map((entry) => {
      const capability = entry.manifest;
      return {
        autonomyTier: capability.autonomy_tier,
        capabilityType: capability.capability_type,
        domain: capability.domain,
        id: capability.id,
        lifecycle: {
          commit: Boolean(capability.lifecycle.commit),
          prepare: Boolean(capability.lifecycle.prepare),
          read: capability.capability_type.includes("read"),
          select: capability.capability_type.includes("read") || capability.capability_type.includes("prepare"),
          verify: Boolean(capability.lifecycle.verify)
        },
        name: capability.name,
        riskTier: capability.risk_tier,
        status: capability.status,
        version: capability.version
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function summarizeRisks(riskResults: Array<ReturnType<typeof compileCapabilityRisk>>): RiskInventoryItem[] {
  return riskResults
    .map((result) => ({
      capabilityId: result.capabilityId,
      declaredRiskTier: result.declaredRiskTier,
      inferredRiskTier: result.inferredMinimumRiskTier,
      passed: result.passed,
      requiredControls: result.requiredControls.filter((control) => control.required).map((control) => control.code).sort(),
      warnings: result.warnings.map((warning) => warning.message)
    }))
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

export function summarizeProviders(report: EvidenceExportInput["conformanceReport"]): ProviderInventoryItem[] {
  const configured = new Map((report?.providerResults ?? []).map((provider) => [provider.provider, provider]));
  return listProviderTargets().map((target) => ({
    label: target.label,
    provider: target.canonicalProvider,
    status: configured.has(target.canonicalProvider) ? "available" : "not_supplied"
  }));
}

export function summarizePolicies(registry: ManifestRegistry): PolicyInventoryItem[] {
  return registry.capabilities
    .map((entry) => {
      const capability = entry.manifest;
      return {
        approvalRequired: Boolean(capability.lifecycle.approve || capability.policy?.approval_required),
        auditRequired: Boolean(capability.lifecycle.audit),
        capabilityId: capability.id,
        idempotencyRequired: Boolean(capability.idempotency?.required),
        permissions: policyPermissions(capability),
        policyRules: [
          ...(capability.policy?.approval_required_if ?? []),
          ...(capability.policy?.deny_if ?? [])
        ].map((rule) => rule.rule).sort()
      };
    })
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

export function summarizeEvalCoverage(
  registry: ManifestRegistry,
  evalSuiteResult: EvalSuiteResult | undefined,
  gaps: EvidenceCoverageGap[] = []
): EvidenceEvalSummary {
  if (!evalSuiteResult) {
    gaps.push(gap("eval_results_not_supplied", "Eval candidate results were not supplied; the pack reports manifest coverage only.", "warning", "eval"));
    const capabilitiesWithEvalCoverage = evalCoveredCapabilities(registry).size;
    if (capabilitiesWithEvalCoverage === 0) {
      gaps.push(gap("eval_coverage_missing", "No eval coverage was found in the manifest registry.", "blocking", "eval"));
    }
    return {
      failed: 0,
      gaps: registry.capabilities.length - capabilitiesWithEvalCoverage,
      passed: 0,
      status: "not_supplied",
      total: registry.evals.length,
      warnings: 1
    };
  }

  if (!evalSuiteResult.passed) {
    gaps.push(gap("eval_suite_failed", "Supplied eval results did not fully pass.", "blocking", "eval"));
  }

  return {
    failed: evalSuiteResult.summary.failed,
    gaps: 0,
    passed: evalSuiteResult.summary.passed,
    status: "available",
    total: evalSuiteResult.summary.total,
    warnings: evalSuiteResult.diagnostics.length
  };
}

export function summarizeSecurityCoverage(
  report: EvidenceExportInput["securityReport"],
  gaps: EvidenceCoverageGap[] = []
): EvidenceSecuritySummary {
  if (!report) {
    gaps.push(gap("security_report_not_supplied", "Security-pack coverage was not supplied.", "warning", "security"));
    return {
      failed: 0,
      gaps: 1,
      missingRequired: 0,
      passed: 0,
      status: "not_supplied",
      total: 0,
      warnings: 1
    };
  }

  if (!report.passed) {
    gaps.push(gap("security_pack_coverage_missing", "One or more capabilities are missing required security-pack coverage.", "blocking", "security"));
  }

  return {
    failed: report.capabilities.filter((item) => item.missingRequiredPacks.length > 0).length,
    gaps: report.missingRequired,
    missingRequired: report.missingRequired,
    passed: report.capabilities.length - report.capabilities.filter((item) => item.missingRequiredPacks.length > 0).length,
    status: "available",
    total: report.capabilities.length,
    warnings: report.capabilities.reduce((count, item) => count + item.warnings.length, 0)
  };
}

export function summarizeConformance(
  report: EvidenceExportInput["conformanceReport"],
  gaps: EvidenceCoverageGap[] = []
): EvidenceConformanceSummary {
  if (!report) {
    gaps.push(gap("conformance_report_not_supplied", "Provider conformance report was not supplied.", "info", "conformance"));
    return {
      failed: 0,
      gaps: 1,
      passed: 0,
      providers: 0,
      status: "not_supplied",
      total: 0,
      warnings: 0
    };
  }

  if (!report.passed) {
    gaps.push(gap("provider_conformance_failed", "Supplied provider conformance report did not pass.", "blocking", "conformance"));
  }

  return {
    failed: report.summary.fail,
    gaps: 0,
    passed: report.summary.pass,
    providers: report.summary.providers,
    status: "available",
    total: report.summary.results,
    warnings: report.summary.warn
  };
}

export function summarizeApprovals(controlPlaneEvidence: EvidenceExportInput["controlPlaneEvidence"], gaps: EvidenceCoverageGap[] = []): EvidenceApprovalSummary {
  if (!controlPlaneEvidence) {
    gaps.push(gap("approval_records_not_supplied", "Approval ledger/control-plane records were not supplied.", "info", "approval"));
    return {
      approved: 0,
      pending: 0,
      rejected: 0,
      status: "not_supplied",
      total: 0
    };
  }

  return {
    approved: controlPlaneEvidence.approvals.filter((approval) => approval.status === "approved").length,
    pending: controlPlaneEvidence.approvals.filter((approval) => approval.status === "pending").length,
    rejected: controlPlaneEvidence.approvals.filter((approval) => approval.status === "rejected").length,
    status: "available",
    total: controlPlaneEvidence.approvals.length
  };
}

export function summarizeHumanReview(registry: ManifestRegistry): HumanReviewPolicySummary {
  const approvalRequiredCapabilities = registry.capabilities.filter((entry) => entry.manifest.lifecycle.approve || entry.manifest.policy?.approval_required).length;
  const highRiskCapabilities = registry.capabilities.filter((entry) => entry.manifest.risk_tier === "high" || entry.manifest.risk_tier === "critical").length;
  return {
    approvalRequiredCapabilities,
    humanReviewRequiredCapabilities: Math.max(approvalRequiredCapabilities, highRiskCapabilities),
    status: "available"
  };
}

export function summarizeRetention(): EvidenceRetentionSummary {
  const policy = defaultRetentionPolicy();
  return {
    auditRecordRetentionDays: policy.auditRecordRetentionDays,
    evalDatasetRetentionDays: policy.evalDatasetRetentionDays,
    rawPromptRetention: policy.rawPromptRetention,
    rawProviderPayloadRetention: policy.rawProviderPayloadRetention,
    status: "available",
    traceMetadataRetentionDays: policy.traceMetadataRetentionDays
  };
}

export function evidenceDisclaimers(): EvidenceDisclaimer[] {
  return [{
    code: "not_certification",
    text: evidencePackDisclaimerText
  }];
}

function summarizeIncident(input: NonNullable<EvidenceExportInput["incidentSummary"]>): EvidenceIncidentSummary {
  return {
    open: input.open ?? 0,
    resolved: input.resolved ?? 0,
    status: "available",
    total: input.total ?? (input.open ?? 0) + (input.resolved ?? 0)
  };
}

function summarizeRiskMappings(riskResults: Array<ReturnType<typeof compileCapabilityRisk>>) {
  const mappings = new Map<string, { category: string; control: string; framework: "aicf" | "nist_ai_rmf" | "owasp_llm_top_10" | "custom" }>();
  for (const result of riskResults) {
    for (const control of result.requiredControls) {
      mappings.set(`aicf:${control.code}`, {
        category: result.inferredMinimumRiskTier,
        control: control.code,
        framework: "aicf"
      });
    }
  }
  return [...mappings.values()].sort((left, right) => left.control.localeCompare(right.control));
}

function sanitizeModelUpgradeHistory(records: ModelUpgradeRecord[] | undefined): ModelUpgradeRecord[] | undefined {
  return records?.map((record) => ({
    changedAt: record.changedAt,
    fromModel: record.fromModel,
    reason: record.reason,
    toModel: record.toModel
  }));
}

function policyPermissions(capability: CapabilityManifest): string[] {
  const permissions = new Set<string>();
  for (const permission of capability.authorization.permissions ?? []) {
    permissions.add(permission);
  }
  return [...permissions].sort();
}

function evalCoveredCapabilities(registry: ManifestRegistry): Set<string> {
  const covered = new Set<string>();
  for (const entry of registry.evals) {
    const evalCase = entry.manifest;
    if (evalCase.capability_under_test) {
      covered.add(evalCase.capability_under_test);
    }
    for (const capabilityId of evalCase.expected.selected_capabilities?.includes ?? []) {
      covered.add(capabilityId);
    }
    for (const toolCall of evalCase.expected.tool_calls ?? []) {
      covered.add(toolCall.capability_id);
    }
    for (const toolCall of evalCase.expected.forbidden_tool_calls ?? []) {
      covered.add(toolCall.capability_id);
    }
  }
  return covered;
}

function gap(code: string, message: string, severity: EvidenceCoverageGap["severity"], source: string): EvidenceCoverageGap {
  return {
    code,
    message,
    severity,
    source
  };
}

function getEvidencePackValidator(): ValidateFunction {
  if (!evidencePackValidator) {
    evidencePackValidator = ajv.compile(JSON.parse(readFileSync(path.join(schemaDirectory, "evidence/evidence-pack.schema.json"), "utf8")));
  }
  return evidencePackValidator;
}
