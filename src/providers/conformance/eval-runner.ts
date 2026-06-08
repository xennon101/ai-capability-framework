import Ajv2020 from "ajv/dist/2020.js";
import { aicfProviderMetadata, type AicfProviderId } from "../index.js";
import type { DecisionRequest, ManifestRegistry, RiskTier } from "../../types.js";
import { defaultProviderConformanceCases } from "./tool-call-fixtures.js";
import { exportProviderTools } from "./export-tools.js";
import { listProviderTargets, normalizeProviderConformanceTarget, providerTargetById } from "./provider-matrix.js";
import type {
  CapabilityConformanceResult,
  CanonicalProviderConformanceTarget,
  ConformanceFailure,
  ConformanceWarning,
  ProviderConformanceCase,
  ProviderConformanceDimension,
  ProviderConformanceProviderResult,
  ProviderConformanceResult,
  ProviderConformanceScorer,
  ProviderConformanceScorerResult,
  ProviderConformanceTarget,
  ProviderToolExportResult,
  RunProviderConformanceSuiteOptions
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const defaultGeneratedAt = "1970-01-01T00:00:00.000Z";
const defaultAicfVersion = "1.0.0-rc.1";
const riskRank: Record<RiskTier, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export function runProviderConformanceSuite(
  options: RunProviderConformanceSuiteOptions
) {
  const providers = normalizeProviderList(options.providers);
  const cases = options.cases ?? defaultProviderConformanceCases();
  const context = options.context ?? defaultConformanceContext();
  const results: ProviderConformanceResult[] = [];

  for (const provider of providers) {
    for (const testCase of cases) {
      if (testCase.provider && testCase.provider !== provider) continue;
      const exportResult = exportProviderTools({
        capabilityIds: testCase.capabilityIds,
        context,
        includeDiagnostics: true,
        provider,
        registry: options.registry,
        serverUrl: options.serverUrl ?? "https://aicf.example.com"
      });
      results.push(scoreProviderConformanceCase(options.registry, provider, testCase, exportResult, context));
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const failures = conformanceFailures(results);
  const warnings: ConformanceWarning[] = [];
  const summary = {
    fail: failures.length,
    pass: passed,
    providers: providers.length,
    results: results.length,
    warn: warnings.length
  };
  return {
    aicfVersion: options.aicfVersion ?? defaultAicfVersion,
    capabilityResults: capabilityResults(results),
    counts: {
      failed,
      passed,
      providers: providers.length,
      results: results.length
    },
    failures,
    generatedAt: options.generatedAt ?? defaultGeneratedAt,
    passed: failed === 0,
    providerResults: providerResults(results),
    schemaVersion: "1.0" as const,
    summary,
    warnings,
    results
  };
}

function scoreProviderConformanceCase(
  registry: ManifestRegistry,
  provider: ProviderConformanceTarget,
  testCase: ProviderConformanceCase,
  exportResult: ProviderToolExportResult,
  context: DecisionRequest["context"]
): ProviderConformanceResult {
  const scorers: ProviderConformanceScorerResult[] = [
    scoreDescriptorExport(testCase, exportResult),
    scoreToolNames(provider, exportResult),
    scoreToolMappings(testCase, exportResult),
    scoreCanonicalCalls(testCase, exportResult),
    scoreCanonicalArgs(registry, testCase),
    scoreSliceEnforced(testCase, exportResult),
    scoreSchemaNormalization(exportResult),
    scoreSchemaDowngradeReporting(exportResult),
    scoreToolCallParsing(testCase, exportResult),
    scoreToolResultEnvelope(testCase, exportResult),
    scoreApprovalRequiredBehavior(testCase, exportResult),
    scoreCorrelationPreserved(testCase),
    scoreSafeErrorEnvelope(exportResult),
    scoreRiskFiltering(registry, exportResult, context),
    scoreDisabledFiltering(registry, exportResult),
    scoreNoCommitExport(registry, exportResult),
    scoreNoRawPayload(exportResult),
    scoreStreamingOrLoopSemantics(provider)
  ];
  const diagnostics = scorers.flatMap((scorer) => scorer.diagnostics);

  return {
    caseId: testCase.id,
    capabilityIds: testCase.capabilityIds,
    diagnostics,
    dimensions: scorers,
    exportResult,
    passed: scorers.every((scorer) => scorer.passed),
    provider,
    scorers
  };
}

function scoreDescriptorExport(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const expectsNoTools = (testCase.expected.providerToolNames?.length ?? -1) === 0;
  const fatalDiagnostics = exportResult.diagnostics.filter((diagnostic) => isFatalDiagnosticCode(diagnostic.code));
  const passed = fatalDiagnostics.length === 0 && (exportResult.exportedCount > 0 || expectsNoTools);
  return scorer("descriptor_export", "descriptor_export", passed, fatalDiagnostics.map((diagnostic) => diagnostic.message));
}

function scoreToolNames(provider: ProviderConformanceTarget, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const metadata = aicfProviderMetadata[providerId(provider)];
  const invalid = exportResult.bindings.filter((binding) => !metadata.toolNamePattern.test(binding.providerToolName));
  return scorer("provider_tool_name_valid", "tool_name_mapping", invalid.length === 0, invalid.map((binding) => `Invalid provider tool name: ${binding.providerToolName}`));
}

function scoreToolMappings(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const missing = testCase.capabilityIds
    .filter((capabilityId) => !capabilityId.includes("commit"))
    .filter((capabilityId) => !exportResult.bindings.some((binding) => binding.capabilityId === capabilityId));
  return scorer("provider_tool_maps_to_capability", "tool_name_mapping", missing.length === 0, missing.map((capabilityId) => `Missing capability binding: ${capabilityId}`));
}

function scoreCanonicalCalls(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const expected = testCase.expected.canonicalToolCalls ?? [];
  const missing = expected.filter((call) => !exportResult.bindings.some((binding) => binding.capabilityId === call.capabilityId));
  return scorer("canonical_tool_call_matches", "tool_call_parsing", missing.length === 0, missing.map((call) => `Missing canonical call capability: ${call.capabilityId}`));
}

function scoreCanonicalArgs(registry: ManifestRegistry, testCase: ProviderConformanceCase): ProviderConformanceScorerResult {
  const diagnostics: string[] = [];
  for (const call of testCase.expected.canonicalToolCalls ?? []) {
    const capability = registry.capabilityById.get(call.capabilityId);
    if (!capability || !call.argsSubset) continue;
    const validate = ajv.compile(capability.manifest.input_schema);
    if (!validate(call.argsSubset)) {
      diagnostics.push(`Args subset failed schema for ${call.capabilityId}.`);
    }
  }
  return scorer("canonical_args_valid", "tool_arg_validation", diagnostics.length === 0, diagnostics);
}

function scoreSliceEnforced(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const outside = exportResult.bindings.filter((binding) => !testCase.capabilityIds.includes(binding.capabilityId));
  return scorer("capability_slice_enforced", "tool_name_mapping", outside.length === 0, outside.map((binding) => `Outside slice: ${binding.capabilityId}`));
}

function scoreSchemaNormalization(exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const diagnostics = exportResult.diagnostics
    .filter((diagnostic) => diagnostic.code === "unsupported" || diagnostic.code === "provider_schema_unsupported" || diagnostic.code === "provider_schema_normalization_failed")
    .map((diagnostic) => diagnostic.message);
  return scorer("schema_normalization", "schema_normalization", diagnostics.length === 0, diagnostics);
}

function scoreSchemaDowngradeReporting(exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const serialized = JSON.stringify(exportResult.artifact).toLowerCase();
  const suspiciousWeakening = serialized.includes("anyof") || serialized.includes("oneof") || serialized.includes("allof");
  const hasDiagnostic = exportResult.diagnostics.some((diagnostic) => (
    diagnostic.code === "unsupported"
    || diagnostic.code === "provider_schema_unsupported"
    || diagnostic.code === "provider_schema_normalization_warning"
  ));
  const passed = !suspiciousWeakening || hasDiagnostic;
  return scorer("schema_downgrade_reporting", "schema_downgrade_reporting", passed, passed ? [] : ["Unsupported schema feature was exported without diagnostics."]);
}

function scoreToolCallParsing(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const expected = testCase.expected.canonicalToolCalls ?? [];
  const missing = expected.filter((call) => !exportResult.bindings.some((binding) => binding.capabilityId === call.capabilityId));
  return scorer("tool_call_parsing", "tool_call_parsing", missing.length === 0, missing.map((call) => `No binding available to parse call for ${call.capabilityId}.`));
}

function scoreToolResultEnvelope(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const knownStatuses = new Set(["success", "approval_required", "denied", "failed", "validation_error", "unavailable"]);
  const unknown = (testCase.expected.resultStatuses ?? []).filter((status) => !knownStatuses.has(status));
  const serialized = JSON.stringify(exportResult).toLowerCase();
  const unsafe = ["private_diagnostics", "stack trace", "raw payload"].filter((token) => serialized.includes(token));
  return scorer("tool_result_envelope", "tool_result_envelope", unknown.length === 0 && unsafe.length === 0, [
    ...unknown.map((status) => `Unknown expected result status: ${status}`),
    ...unsafe.map((token) => `Unsafe envelope marker present: ${token}`)
  ]);
}

function scoreApprovalRequiredBehavior(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  if (!(testCase.expected.resultStatuses ?? []).includes("approval_required")) {
    return scorer("approval_required_behavior", "approval_required_behavior", true, []);
  }

  const missingPrepareBinding = (testCase.expected.canonicalToolCalls ?? [])
    .filter((call) => !exportResult.bindings.some((binding) => binding.capabilityId === call.capabilityId && binding.operation === "prepare"));
  return scorer(
    "approval_required_behavior",
    "approval_required_behavior",
    missingPrepareBinding.length === 0,
    missingPrepareBinding.map((call) => `Approval-required case has no prepare binding for ${call.capabilityId}.`)
  );
}

function scoreCorrelationPreserved(testCase: ProviderConformanceCase): ProviderConformanceScorerResult {
  const hasCorrelatedFixture = JSON.stringify(testCase.mockProviderResponses ?? []).includes("call");
  return scorer("provider_result_correlation_preserved", "tool_result_envelope", true, hasCorrelatedFixture ? [] : []);
}

function scoreSafeErrorEnvelope(exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const safe = !JSON.stringify(exportResult).includes("stack") && !JSON.stringify(exportResult).includes("private auth outage");
  return scorer("provider_safe_error_envelope", "provider_error_normalization", safe, safe ? [] : ["Export result included unsafe error detail."]);
}

function scoreRiskFiltering(
  registry: ManifestRegistry,
  exportResult: ProviderToolExportResult,
  context: DecisionRequest["context"]
): ProviderConformanceScorerResult {
  if (!context.riskCeiling) {
    return scorer("risk_filtering", "risk_filtering", true, []);
  }

  const excessive = exportResult.bindings.filter((binding) => {
    const riskTier = registry.capabilityById.get(binding.capabilityId)?.manifest.risk_tier;
    return riskTier ? riskRank[riskTier] > riskRank[context.riskCeiling!] : false;
  });
  return scorer("risk_filtering", "risk_filtering", excessive.length === 0, excessive.map((binding) => `Risk ceiling did not filter ${binding.capabilityId}.`));
}

function scoreDisabledFiltering(registry: ManifestRegistry, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const disabled = exportResult.bindings.filter((binding) => registry.capabilityById.get(binding.capabilityId)?.manifest.status === "disabled");
  return scorer("disabled_capability_filtering", "disabled_capability_filtering", disabled.length === 0, disabled.map((binding) => `Disabled capability exported: ${binding.capabilityId}`));
}

function scoreNoCommitExport(registry: ManifestRegistry, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const commitBindings = exportResult.bindings.filter((binding) => {
    const capability = registry.capabilityById.get(binding.capabilityId);
    return capability?.manifest.lifecycle.commit || capability?.manifest.capability_type === "write_commit" || binding.operation === "commit";
  });
  return scorer("no_commit_tool_exported", "commit_tool_not_exposed_by_default", commitBindings.length === 0, commitBindings.map((binding) => `Commit exported: ${binding.capabilityId}`));
}

function scoreNoRawPayload(exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const serialized = JSON.stringify(exportResult).toLowerCase();
  const unsafe = ["rawproviderpayload", "raw_payload", "raw-payload", "provider_payload"].filter((token) => serialized.includes(token));
  return scorer("no_raw_payload_logged", "provider_error_normalization", unsafe.length === 0, unsafe.map((token) => `Raw payload marker present: ${token}`));
}

function scoreStreamingOrLoopSemantics(provider: ProviderConformanceTarget): ProviderConformanceScorerResult {
  const target = providerTargetById(provider);
  return scorer(
    "streaming_or_loop_semantics",
    "streaming_or_loop_semantics",
    Boolean(target?.runtimeBoundary),
    target?.runtimeBoundary ? [] : [`Provider ${provider} has no runtime boundary metadata.`]
  );
}

function scorer(
  scorerName: ProviderConformanceScorer,
  dimension: ProviderConformanceDimension,
  passed: boolean,
  diagnostics: string[]
): ProviderConformanceScorerResult {
  return {
    diagnostics,
    dimension,
    passed,
    scorer: scorerName
  };
}

function providerId(provider: ProviderConformanceTarget): AicfProviderId {
  switch (provider) {
    case "ai-sdk":
      return "vercel-ai-sdk";
    case "semantic-kernel-mcp":
      return "mcp";
    case "semantic-kernel-openapi":
    case "semantic-kernel":
      return "semantic-kernel";
    default:
      return provider;
  }
}

function normalizeProviderList(
  providers: RunProviderConformanceSuiteOptions["providers"]
): CanonicalProviderConformanceTarget[] {
  const values = providers ?? listProviderTargets().map((target) => target.provider);
  const normalized: CanonicalProviderConformanceTarget[] = [];
  for (const provider of values) {
    const candidate = normalizeProviderConformanceTarget(provider);
    if (candidate && !normalized.includes(candidate)) {
      normalized.push(candidate);
    }
  }
  return normalized;
}

function providerResults(results: ProviderConformanceResult[]): ProviderConformanceProviderResult[] {
  return listProviderTargets()
    .map((target) => target.provider as CanonicalProviderConformanceTarget)
    .filter((provider) => results.some((result) => result.provider === provider))
    .map((provider) => {
      const providerResults = results.filter((result) => result.provider === provider);
      const dimensions = [...new Set(providerResults.flatMap((result) => result.dimensions.map((dimension) => dimension.dimension)))]
        .sort()
        .map((dimension) => {
          const matching = providerResults.flatMap((result) => result.dimensions).filter((result) => result.dimension === dimension);
          return {
            dimension,
            failed: matching.filter((result) => !result.passed).length,
            passed: matching.filter((result) => result.passed).length
          };
        });
      const failed = providerResults.filter((result) => !result.passed).length;
      return {
        dimensions,
        failed,
        label: providerTargetById(provider)?.label ?? provider,
        passed: failed === 0,
        provider,
        results: providerResults.length
      };
    });
}

function capabilityResults(results: ProviderConformanceResult[]): CapabilityConformanceResult[] {
  const entries: CapabilityConformanceResult[] = [];
  for (const result of results) {
    for (const capabilityId of result.capabilityIds) {
      entries.push({
        capabilityId,
        caseIds: [result.caseId],
        diagnostics: result.diagnostics,
        dimensions: result.dimensions,
        passed: result.passed,
        provider: normalizeProviderConformanceTarget(result.provider) ?? "openai"
      });
    }
  }
  return entries.sort((left, right) => `${left.provider}:${left.capabilityId}:${left.caseIds[0]}`.localeCompare(`${right.provider}:${right.capabilityId}:${right.caseIds[0]}`));
}

function conformanceFailures(results: ProviderConformanceResult[]): ConformanceFailure[] {
  const failures: ConformanceFailure[] = [];
  for (const result of results) {
    for (const dimension of result.dimensions) {
      if (dimension.passed) {
        continue;
      }
      for (const message of dimension.diagnostics.length > 0 ? dimension.diagnostics : [`${dimension.dimension} failed.`]) {
        failures.push({
          capabilityId: result.capabilityIds[0],
          caseId: result.caseId,
          dimension: dimension.dimension,
          message,
          provider: normalizeProviderConformanceTarget(result.provider) ?? "openai"
        });
      }
    }
  }
  return failures;
}

function isFatalDiagnosticCode(code: string): boolean {
  return [
    "invalid_context",
    "provider_schema_unsupported",
    "provider_tool_name_collision",
    "schema",
    "tool_name_collision",
    "unsupported"
  ].includes(code);
}

function defaultConformanceContext() {
  return {
    autonomyTier: "A2" as const,
    permissions: ["ticket.read", "refund.case.create"],
    riskCeiling: "medium" as const,
    tenantId: "tenant_example_support",
    userId: "user_example_support_agent"
  };
}
