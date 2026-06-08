import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import YAML from "yaml";
import { runConformanceSuite } from "../conformance/index.js";
import { loadManifests } from "../loader.js";
import { buildRegistry } from "../registry.js";
import { assessSecurityPackCoverage } from "../security-packs/index.js";
import type { AicfDiagnostic, CapabilityManifest, LoadedEvalCase, ManifestRegistry, RiskTier } from "../types.js";
import { validateCapabilityInvariants, validateManifests, validatePublicFixtures } from "../validator.js";
import { compareCapabilityVersions } from "./compatibility.js";
import { riskAtLeast } from "./helpers.js";
import { analyzeCapabilityImpact } from "./impact.js";
import { evaluateLifecycleTransition } from "./lifecycle.js";
import { compileCapabilityRisk } from "./risk-compiler.js";
import type {
  CapabilityLifecycleStatus,
  GovernanceGateCheck,
  GovernanceGateConfig,
  GovernanceGateExitCode,
  GovernanceGateReport,
  GovernanceGateSettings,
  LoadGovernanceGateConfigOptions,
  LoadGovernanceGateConfigResult,
  RunGovernanceGateInput
} from "./types.js";
import { normalizeProviderConformanceTarget, type CanonicalProviderConformanceTarget } from "../providers/conformance/index.js";

const schemaDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schemas");
const ajv = new Ajv2020({ allErrors: true, strict: false });
const gateConfigValidator = compileSchema("governance/gate-config.schema.json");
const defaultGeneratedAt = "1970-01-01T00:00:00.000Z";

const forbiddenPathSegments = new Set([
  ".aicf",
  "_private",
  "dist-source",
  "generated-docs",
  "local",
  "logs",
  "node_modules",
  "private",
  "promptfoo-results",
  "prompts",
  "test-results",
  "traces"
]);
const forbiddenExtensions = new Set([".docx", ".log", ".pdf", ".pptx", ".tgz", ".xlsx", ".zip"]);

const defaultConfig: GovernanceGateConfig = {
  schema_version: "1.0"
};

const productionDefaults: GovernanceGateSettings = {
  artifactHygiene: true,
  blockDeprecatedCapabilities: true,
  failOnWarnings: false,
  requireConformanceForEnabledProviders: true,
  requireEvalsFor: ["medium", "high", "critical"],
  requireSecurityPacksFor: ["high", "critical"]
};

export async function loadGovernanceGateConfig(
  pathOrRoot = process.cwd(),
  options: LoadGovernanceGateConfigOptions = {}
): Promise<LoadGovernanceGateConfigResult> {
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : await findGateConfig(path.resolve(pathOrRoot));

  if (!configPath) {
    return {
      config: defaultConfig,
      diagnostics: []
    };
  }

  try {
    const config = await readStructuredConfig(configPath);
    const valid = gateConfigValidator(config);
    if (!valid) {
      return {
        config: defaultConfig,
        diagnostics: schemaDiagnostics(configPath, gateConfigValidator),
        path: toRelative(configPath)
      };
    }

    return {
      config: config as GovernanceGateConfig,
      diagnostics: [],
      path: toRelative(configPath)
    };
  } catch (error) {
    return {
      config: defaultConfig,
      diagnostics: [{
        code: "parse",
        message: error instanceof Error ? error.message : "Unable to parse governance gate config.",
        path: toRelative(configPath)
      }],
      path: toRelative(configPath)
    };
  }
}

export async function runGovernanceGate(input: RunGovernanceGateInput): Promise<GovernanceGateReport> {
  const generatedAt = input.generatedAt ?? defaultGeneratedAt;
  const manifestRoot = path.resolve(input.manifestRoot);
  const configResult = input.config
    ? { config: input.config, diagnostics: [], path: input.configPath ? toRelative(path.resolve(input.configPath)) : undefined }
    : await loadGovernanceGateConfig(manifestRoot, { configPath: input.configPath, environment: input.environment });
  const environment = input.environment ?? configResult.config.project?.environment ?? "production";
  const checks: GovernanceGateCheck[] = [];

  const configFailures = configResult.diagnostics.map(formatDiagnostic);
  const normalizedProviders = normalizeConfiguredProviders(configResult.config.providers?.enabled ?? []);
  configFailures.push(...normalizedProviders.errors);
  checks.push(check("config", "Gate config", "Loaded governance gate configuration.", configFailures, []));
  if (configFailures.length > 0) {
    return report({
      checks,
      configPath: configResult.path,
      environment,
      exitCode: 2,
      generatedAt,
      manifestRoot
    });
  }

  const settings = resolveGateSettings(configResult.config, environment, input);
  const loaded = await loadManifests({ path: manifestRoot });
  const manifestValidation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  const validationFailures = [
    ...loaded.errors,
    ...manifestValidation.errors,
    ...fixtureValidation.errors
  ].map(formatDiagnostic);
  const validationWarnings = manifestValidation.warnings.map(formatDiagnostic);

  checks.push(check(
    "validation",
    "Manifest and fixture validation",
    `Validated ${loaded.manifests.length} manifest(s) and ${loaded.fixtures.length} fixture(s).`,
    validationFailures,
    validationWarnings
  ));

  if (validationFailures.length > 0) {
    checks.push(skippedCheck("semantic_invariants", "Semantic invariants", "Skipped because validation failed."));
    checks.push(skippedCheck("risk", "Risk compilation", "Skipped because validation failed."));
    checks.push(skippedCheck("lifecycle", "Lifecycle checks", "Skipped because validation failed."));
    checks.push(skippedCheck("compatibility", "Compatibility baseline", "Skipped because validation failed."));
    checks.push(skippedCheck("impact", "Impact analysis", "Skipped because validation failed."));
    checks.push(skippedCheck("eval_coverage", "Eval coverage", "Skipped because validation failed."));
    checks.push(skippedCheck("security_packs", "Security-pack coverage", "Skipped because validation failed."));
    checks.push(skippedCheck("conformance", "Provider conformance", "Skipped because validation failed."));
    checks.push(skippedCheck("artifact_hygiene", "Public artifact hygiene", "Skipped because validation failed."));
    return report({
      checks,
      configPath: configResult.path,
      environment,
      exitCode: 1,
      failOnWarnings: settings.failOnWarnings,
      generatedAt,
      manifestRoot
    });
  }

  const registry = buildRegistry(loaded.manifests);
  const invariants = validateCapabilityInvariants(loaded.manifests);
  checks.push(check(
    "semantic_invariants",
    "Semantic invariants",
    "Checked capability lifecycle, risk, idempotency, audit, and commit-link invariants.",
    invariants.errors.map(formatDiagnostic),
    invariants.warnings.map(formatDiagnostic)
  ));

  checks.push(riskCheck(registry));
  checks.push(lifecycleCheck(registry, environment, settings, manifestValidation));
  checks.push(await compatibilityCheck(registry, input.baselineRoot ?? configResult.config.compatibility?.baseline_root));
  checks.push(impactCheck(registry));
  checks.push(evalCoverageCheck(registry, settings.requireEvalsFor));
  checks.push(securityPackCheck(registry, settings.requireSecurityPacksFor));
  checks.push(conformanceCheck(registry, normalizedProviders.providers, settings, configResult.config.providers?.server_url));

  if (settings.artifactHygiene) {
    checks.push(await artifactHygieneCheck(manifestRoot));
  } else {
    checks.push(skippedCheck("artifact_hygiene", "Public artifact hygiene", "Skipped by gate settings."));
  }

  return report({
    checks,
    configPath: configResult.path,
    environment,
    failOnWarnings: settings.failOnWarnings,
    generatedAt,
    manifestRoot
  });
}

export function formatGovernanceGateReport(report: GovernanceGateReport, format: "json" | "text" = "text"): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const lines = [
    `AICF governance gate ${report.passed ? "passed" : "failed"} for ${report.environment}.`,
    `Checks: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warning, ${report.summary.skipped} skipped.`
  ];
  for (const checkResult of report.checks) {
    lines.push(`- ${checkResult.status}: ${checkResult.id}: ${checkResult.summary}`);
    for (const failure of checkResult.failures) {
      lines.push(`  - failure: ${failure}`);
    }
    for (const warning of checkResult.warnings) {
      lines.push(`  - warning: ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function riskCheck(registry: ManifestRegistry): GovernanceGateCheck {
  const results = registry.capabilities.map((entry) => compileCapabilityRisk(entry.manifest, {
    entities: registry.entities.map((entity) => entity.manifest)
  }));
  return check(
    "risk",
    "Risk compilation",
    `Compiled risk for ${results.length} capability(ies).`,
    results.flatMap((result) => result.reasons.map((reason) => `${result.capabilityId}: ${reason.code}: ${reason.message}`)),
    results.flatMap((result) => result.warnings.map((warning) => `${result.capabilityId}: ${warning.code}: ${warning.message}`)),
    results
  );
}

function lifecycleCheck(
  registry: ManifestRegistry,
  environment: string,
  settings: GovernanceGateSettings,
  validation: ReturnType<typeof validateManifests>
): GovernanceGateCheck {
  const to = environmentToLifecycleStatus(environment);
  const failures: string[] = [];
  const warnings: string[] = [];
  const details = [];

  for (const entry of registry.capabilities) {
    const capability = entry.manifest;
    if (settings.blockDeprecatedCapabilities && capability.status === "deprecated") {
      failures.push(`${capability.id}: deprecated capabilities are blocked by this gate.`);
    }

    const targetStatus = capability.status === "deprecated" && !settings.blockDeprecatedCapabilities ? "deprecated" : to;
    const decision = evaluateLifecycleTransition(registry, {
      capabilityId: capability.id,
      reason: `F8 ${environment} gate`,
      to: targetStatus
    }, {
      deterministicEvalsPassed: true,
      evalGatePassed: true,
      validation
    });
    details.push({ capabilityId: capability.id, decision });
    failures.push(...decision.reasons.filter((reason) => reason.severity === "blocking").map((reason) => `${capability.id}: ${reason.code}: ${reason.message}`));
    failures.push(...decision.requiredActions.filter((action) => action.severity === "blocking").map((action) => `${capability.id}: ${action.code}: ${action.message}`));
    warnings.push(...decision.warnings.map((warning) => `${capability.id}: ${warning.code}: ${warning.message}`));
  }

  return check("lifecycle", "Lifecycle checks", `Checked lifecycle posture for ${registry.capabilities.length} capability(ies).`, failures, warnings, details);
}

async function compatibilityCheck(registry: ManifestRegistry, baselineRoot: string | undefined): Promise<GovernanceGateCheck> {
  if (!baselineRoot) {
    return skippedCheck("compatibility", "Compatibility baseline", "No baseline root configured.");
  }

  const loaded = await loadManifests({ path: baselineRoot });
  const validation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  const loadFailures = [...loaded.errors, ...validation.errors, ...fixtureValidation.errors].map(formatDiagnostic);
  if (loadFailures.length > 0) {
    return check("compatibility", "Compatibility baseline", "Baseline failed validation.", loadFailures, validation.warnings.map(formatDiagnostic));
  }

  const baseline = buildRegistry(loaded.manifests);
  const failures: string[] = [];
  const warnings: string[] = [];
  const details = [];
  for (const current of registry.capabilities) {
    const previous = baseline.capabilityById.get(current.manifest.id);
    if (!previous) {
      warnings.push(`${current.manifest.id}: no baseline capability found.`);
      continue;
    }

    const diff = compareCapabilityVersions(previous.manifest, current.manifest);
    details.push(diff);
    if (diff.compatibility === "breaking") {
      failures.push(`${diff.capabilityId}: breaking compatibility change from ${diff.fromVersion} to ${diff.toVersion}.`);
    } else if (diff.compatibility === "requires_minor") {
      warnings.push(`${diff.capabilityId}: minor compatibility change from ${diff.fromVersion} to ${diff.toVersion}.`);
    }
  }

  return check("compatibility", "Compatibility baseline", `Compared ${registry.capabilities.length} capability(ies) with baseline.`, failures, warnings, details);
}

function impactCheck(registry: ManifestRegistry): GovernanceGateCheck {
  const reports = registry.capabilities.map((entry) => analyzeCapabilityImpact(registry, entry.manifest.id));
  return check(
    "impact",
    "Impact analysis",
    `Analyzed direct impact for ${reports.length} capability(ies).`,
    reports.flatMap((report) => report.missingCoverage.filter((gap) => gap.severity === "blocking").map((gap) => `${report.capabilityId}: ${gap.code}: ${gap.message}`)),
    reports.flatMap((report) => report.missingCoverage.filter((gap) => gap.severity !== "blocking").map((gap) => `${report.capabilityId}: ${gap.code}: ${gap.message}`)),
    reports
  );
}

function evalCoverageCheck(registry: ManifestRegistry, requiredRiskTiers: RiskTier[]): GovernanceGateCheck {
  const covered = evalCoveredCapabilities(registry.evals);
  const missing = registry.capabilities
    .filter((entry) => requiredRiskTiers.includes(entry.manifest.risk_tier))
    .filter((entry) => !covered.has(entry.manifest.id))
    .map((entry) => `${entry.manifest.id}: eval coverage is required for ${entry.manifest.risk_tier} risk.`);

  return check("eval_coverage", "Eval coverage", `Checked eval coverage for ${requiredRiskTiers.join(", ")} risk tiers.`, missing, []);
}

function securityPackCheck(registry: ManifestRegistry, requiredRiskTiers: RiskTier[]): GovernanceGateCheck {
  const coverage = assessSecurityPackCoverage(registry);
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const item of coverage.capabilities) {
    if (!requiredRiskTiers.includes(item.riskTier)) {
      continue;
    }

    if (item.missingRequiredPacks.length > 0) {
      failures.push(`${item.capabilityId}: missing security packs: ${item.missingRequiredPacks.join(", ")}.`);
    } else if (item.requiredPacks.length === 0 && item.assignedPacks.length === 0 && item.validWaivers.length === 0) {
      failures.push(`${item.capabilityId}: security-pack coverage is required for ${item.riskTier} risk.`);
    }
    warnings.push(...item.warnings.map((warning) => `${item.capabilityId}: ${warning}`));
  }

  return check("security_packs", "Security-pack coverage", `Checked security-pack coverage for ${requiredRiskTiers.join(", ")} risk tiers.`, failures, warnings, coverage);
}

function conformanceCheck(
  registry: ManifestRegistry,
  providers: CanonicalProviderConformanceTarget[],
  settings: GovernanceGateSettings,
  serverUrl: string | undefined
): GovernanceGateCheck {
  if (!settings.requireConformanceForEnabledProviders) {
    return skippedCheck("conformance", "Provider conformance", "Provider conformance is disabled by gate settings.");
  }

  if (providers.length === 0) {
    return skippedCheck("conformance", "Provider conformance", "No providers are enabled in gate config.");
  }

  const conformance = runConformanceSuite({
    providers,
    registry,
    serverUrl
  });
  return check(
    "conformance",
    "Provider conformance",
    `Ran conformance across ${providers.length} provider target(s).`,
    conformance.failures.map((failure) => `${failure.provider}:${failure.caseId}:${failure.dimension}: ${failure.message}`),
    conformance.warnings.map((warning) => `${warning.provider ?? "provider"}:${warning.dimension ?? "warning"}: ${warning.message}`),
    conformance
  );
}

async function artifactHygieneCheck(manifestRoot: string): Promise<GovernanceGateCheck> {
  const files = await listFiles(manifestRoot);
  const failures = files.flatMap((file) => publicArtifactFailures(file, manifestRoot));
  return check("artifact_hygiene", "Public artifact hygiene", `Scanned ${files.length} file(s) for private/local artifact paths.`, failures, []);
}

function resolveGateSettings(
  config: GovernanceGateConfig,
  environment: string,
  input: RunGovernanceGateInput
): GovernanceGateSettings {
  const configured = config.gates?.[environment] ?? {};
  return {
    artifactHygiene: input.includeArtifactHygiene ?? configured.artifact_hygiene ?? productionDefaults.artifactHygiene,
    blockDeprecatedCapabilities: configured.block_deprecated_capabilities ?? productionDefaults.blockDeprecatedCapabilities,
    failOnWarnings: input.failOnWarnings ?? configured.fail_on_warnings ?? productionDefaults.failOnWarnings,
    requireConformanceForEnabledProviders: configured.require_conformance_for_enabled_providers ?? productionDefaults.requireConformanceForEnabledProviders,
    requireEvalsFor: configured.require_evals_for ?? productionDefaults.requireEvalsFor,
    requireSecurityPacksFor: configured.require_security_packs_for ?? productionDefaults.requireSecurityPacksFor
  };
}

function normalizeConfiguredProviders(values: Array<CanonicalProviderConformanceTarget | string>): {
  errors: string[];
  providers: CanonicalProviderConformanceTarget[];
} {
  const errors: string[] = [];
  const providers: CanonicalProviderConformanceTarget[] = [];
  for (const value of values) {
    const normalized = normalizeProviderConformanceTarget(value);
    if (!normalized) {
      errors.push(`Unknown provider "${value}".`);
      continue;
    }
    if (!providers.includes(normalized)) {
      providers.push(normalized);
    }
  }
  return { errors, providers };
}

function evalCoveredCapabilities(evals: LoadedEvalCase[]): Set<string> {
  const covered = new Set<string>();
  for (const entry of evals) {
    const evalCase = entry.manifest;
    if (evalCase.capability_under_test) {
      covered.add(evalCase.capability_under_test);
    }
    for (const capabilityId of evalCase.expected.selected_capabilities?.includes ?? []) {
      covered.add(capabilityId);
    }
    for (const capabilityId of evalCase.expected.selected_capabilities?.excludes ?? []) {
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

function environmentToLifecycleStatus(environment: string): CapabilityLifecycleStatus {
  if ([
    "draft",
    "review",
    "approved",
    "canary",
    "production",
    "deprecated",
    "disabled",
    "removed"
  ].includes(environment)) {
    return environment as CapabilityLifecycleStatus;
  }
  return "production";
}

function check(
  id: string,
  name: string,
  summary: string,
  failures: string[],
  warnings: string[],
  details?: unknown
): GovernanceGateCheck {
  return {
    details,
    failures,
    id,
    name,
    status: failures.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
    summary,
    warnings
  };
}

function skippedCheck(id: string, name: string, summary: string): GovernanceGateCheck {
  return {
    failures: [],
    id,
    name,
    status: "skipped",
    summary,
    warnings: []
  };
}

function report(input: {
  checks: GovernanceGateCheck[];
  configPath?: string;
  environment: string;
  exitCode?: GovernanceGateExitCode;
  failOnWarnings?: boolean;
  generatedAt: string;
  manifestRoot: string;
}): GovernanceGateReport {
  const failures = input.checks.flatMap((checkResult) => checkResult.failures.map((failure) => `${checkResult.id}: ${failure}`));
  const warnings = input.checks.flatMap((checkResult) => checkResult.warnings.map((warning) => `${checkResult.id}: ${warning}`));
  const failOnWarnings = input.failOnWarnings === true && warnings.length > 0;
  const exitCode = input.exitCode ?? (failures.length > 0 || failOnWarnings ? 1 : 0);
  const passed = exitCode === 0;

  return {
    checks: input.checks,
    configPath: input.configPath,
    environment: input.environment,
    exitCode,
    failures,
    generatedAt: input.generatedAt,
    manifestRoot: toRelative(input.manifestRoot),
    passed,
    schema_version: "1.0",
    summary: {
      failed: input.checks.filter((entry) => entry.status === "failed").length,
      passed: input.checks.filter((entry) => entry.status === "passed").length,
      skipped: input.checks.filter((entry) => entry.status === "skipped").length,
      warnings: input.checks.filter((entry) => entry.status === "warning").length
    },
    warnings
  };
}

async function findGateConfig(root: string): Promise<string | undefined> {
  const candidates = [
    path.join(root, "aicf.config.yaml"),
    path.join(root, "aicf.config.yml"),
    path.join(root, "aicf.config.json"),
    path.join(process.cwd(), "aicf.config.yaml"),
    path.join(process.cwd(), "aicf.config.yml"),
    path.join(process.cwd(), "aicf.config.json")
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function readStructuredConfig(configPath: string): Promise<unknown> {
  const content = await readFile(configPath, "utf8");
  return path.extname(configPath).toLowerCase() === ".json" ? JSON.parse(content) : YAML.parse(content);
}

function schemaDiagnostics(configPath: string, validate: ValidateFunction): AicfDiagnostic[] {
  return (validate.errors ?? []).map((error) => ({
    code: "schema" as const,
    details: error,
    message: `${error.instancePath || "/"}: ${error.message ?? "schema validation failed"}`,
    path: toRelative(configPath)
  }));
}

function compileSchema(fileName: string): ValidateFunction {
  const schemaPath = path.join(schemaDirectory, fileName);
  return ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>);
}

function formatDiagnostic(diagnostic: AicfDiagnostic): string {
  return `${diagnostic.path}: ${diagnostic.id ? `${diagnostic.id}: ` : ""}${diagnostic.code}: ${diagnostic.message}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function publicArtifactFailures(filePath: string, root: string): string[] {
  const normalized = path.relative(root, filePath).replaceAll("\\", "/");
  const lowerFile = normalized.toLowerCase();
  const segments = normalized.split("/");
  const failures: string[] = [];

  if (segments.some((segment) => forbiddenPathSegments.has(segment))) {
    failures.push(`Forbidden path included: ${normalized}`);
  }
  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
    failures.push(`Environment file included: ${normalized}`);
  }
  if (forbiddenExtensions.has(path.extname(normalized).toLowerCase())) {
    failures.push(`Forbidden artifact type included: ${normalized}`);
  }
  if (
    lowerFile.includes("provider-payload")
    || lowerFile.includes("raw-payload")
    || lowerFile.includes("raw_provider")
    || lowerFile.includes("raw-prompt")
    || lowerFile.includes("raw_prompt")
    || lowerFile.includes("raw-trace")
    || lowerFile.includes("raw_trace")
  ) {
    failures.push(`Private or provider payload-looking path included: ${normalized}`);
  }
  if (
    lowerFile.includes("credential")
    || lowerFile.includes("api-key")
    || lowerFile.includes("apikey")
    || lowerFile.includes("access-token")
    || lowerFile.includes("access_token")
  ) {
    failures.push(`Credential-looking path included: ${normalized}`);
  }

  return failures;
}

function toRelative(filePath: string): string {
  return path.relative(process.cwd(), path.resolve(filePath)).replaceAll("\\", "/") || ".";
}
