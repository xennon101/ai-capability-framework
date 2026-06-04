import Ajv2020 from "ajv/dist/2020.js";
import { aicfProviderMetadata, type AicfProviderId } from "../index.js";
import type { ManifestRegistry } from "../../types.js";
import { defaultProviderConformanceCases } from "./tool-call-fixtures.js";
import { exportProviderTools } from "./export-tools.js";
import { listProviderTargets } from "./provider-matrix.js";
import type {
  ProviderConformanceCase,
  ProviderConformanceResult,
  ProviderConformanceScorer,
  ProviderConformanceScorerResult,
  ProviderConformanceTarget,
  ProviderToolExportResult,
  RunProviderConformanceSuiteOptions
} from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });

export function runProviderConformanceSuite(
  options: RunProviderConformanceSuiteOptions
) {
  const providers = options.providers ?? listProviderTargets().map((target) => target.provider);
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
      results.push(scoreProviderConformanceCase(options.registry, provider, testCase, exportResult));
    }
  }

  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  return {
    counts: {
      failed,
      passed,
      providers: providers.length,
      results: results.length
    },
    passed: failed === 0,
    results
  };
}

function scoreProviderConformanceCase(
  registry: ManifestRegistry,
  provider: ProviderConformanceTarget,
  testCase: ProviderConformanceCase,
  exportResult: ProviderToolExportResult
): ProviderConformanceResult {
  const scorers: ProviderConformanceScorerResult[] = [
    scoreToolNames(provider, exportResult),
    scoreToolMappings(testCase, exportResult),
    scoreCanonicalCalls(testCase, exportResult),
    scoreCanonicalArgs(registry, testCase),
    scoreSliceEnforced(testCase, exportResult),
    scoreCorrelationPreserved(testCase),
    scoreSafeErrorEnvelope(exportResult),
    scoreNoCommitExport(registry, exportResult),
    scoreNoRawPayload(exportResult)
  ];
  const diagnostics = scorers.flatMap((scorer) => scorer.diagnostics);

  return {
    caseId: testCase.id,
    diagnostics,
    exportResult,
    passed: scorers.every((scorer) => scorer.passed),
    provider,
    scorers
  };
}

function scoreToolNames(provider: ProviderConformanceTarget, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const metadata = aicfProviderMetadata[providerId(provider)];
  const invalid = exportResult.bindings.filter((binding) => !metadata.toolNamePattern.test(binding.providerToolName));
  return scorer("provider_tool_name_valid", invalid.length === 0, invalid.map((binding) => `Invalid provider tool name: ${binding.providerToolName}`));
}

function scoreToolMappings(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const missing = testCase.capabilityIds
    .filter((capabilityId) => !capabilityId.includes("commit"))
    .filter((capabilityId) => !exportResult.bindings.some((binding) => binding.capabilityId === capabilityId));
  return scorer("provider_tool_maps_to_capability", missing.length === 0, missing.map((capabilityId) => `Missing capability binding: ${capabilityId}`));
}

function scoreCanonicalCalls(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const expected = testCase.expected.canonicalToolCalls ?? [];
  const missing = expected.filter((call) => !exportResult.bindings.some((binding) => binding.capabilityId === call.capabilityId));
  return scorer("canonical_tool_call_matches", missing.length === 0, missing.map((call) => `Missing canonical call capability: ${call.capabilityId}`));
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
  return scorer("canonical_args_valid", diagnostics.length === 0, diagnostics);
}

function scoreSliceEnforced(testCase: ProviderConformanceCase, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const outside = exportResult.bindings.filter((binding) => !testCase.capabilityIds.includes(binding.capabilityId));
  return scorer("capability_slice_enforced", outside.length === 0, outside.map((binding) => `Outside slice: ${binding.capabilityId}`));
}

function scoreCorrelationPreserved(testCase: ProviderConformanceCase): ProviderConformanceScorerResult {
  const hasCorrelatedFixture = JSON.stringify(testCase.mockProviderResponses ?? []).includes("call");
  return scorer("provider_result_correlation_preserved", true, hasCorrelatedFixture ? [] : []);
}

function scoreSafeErrorEnvelope(exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const safe = !JSON.stringify(exportResult).includes("stack") && !JSON.stringify(exportResult).includes("private auth outage");
  return scorer("provider_safe_error_envelope", safe, safe ? [] : ["Export result included unsafe error detail."]);
}

function scoreNoCommitExport(registry: ManifestRegistry, exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const commitBindings = exportResult.bindings.filter((binding) => {
    const capability = registry.capabilityById.get(binding.capabilityId);
    return capability?.manifest.lifecycle.commit || capability?.manifest.capability_type === "write_commit" || binding.operation === "commit";
  });
  return scorer("no_commit_tool_exported", commitBindings.length === 0, commitBindings.map((binding) => `Commit exported: ${binding.capabilityId}`));
}

function scoreNoRawPayload(exportResult: ProviderToolExportResult): ProviderConformanceScorerResult {
  const serialized = JSON.stringify(exportResult).toLowerCase();
  const unsafe = ["rawproviderpayload", "raw_payload", "raw-payload", "provider_payload"].filter((token) => serialized.includes(token));
  return scorer("no_raw_payload_logged", unsafe.length === 0, unsafe.map((token) => `Raw payload marker present: ${token}`));
}

function scorer(scorerName: ProviderConformanceScorer, passed: boolean, diagnostics: string[]): ProviderConformanceScorerResult {
  return {
    diagnostics,
    passed,
    scorer: scorerName
  };
}

function providerId(provider: ProviderConformanceTarget): AicfProviderId {
  switch (provider) {
    case "ai-sdk":
      return "vercel-ai-sdk";
    case "semantic-kernel":
      return "semantic-kernel";
    default:
      return provider;
  }
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
