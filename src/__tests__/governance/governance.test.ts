import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { runCli } from "../../cli.js";
import {
  analyzeCapabilityImpact,
  compareCapabilityVersions,
  compileCapabilityRisk,
  evaluateLifecycleTransition,
  formatGovernanceGateReport,
  loadGovernanceGateConfig,
  runGovernanceGate,
  type GovernanceGateConfig,
  type GovernanceGateEnvironmentConfig
} from "../../governance/index.js";
import { loadManifests } from "../../loader.js";
import { buildRegistry } from "../../registry.js";
import type { CapabilityManifest, LoadedCapabilityManifest, ManifestRegistry } from "../../types.js";

describe("governance domain contracts", () => {
  it("exports governance APIs from the built package subpath", async () => {
    const governance = await import("../../../dist/governance/index.js") as Record<string, unknown>;

    expect(governance.compileCapabilityRisk).toEqual(expect.any(Function));
    expect(governance.evaluateLifecycleTransition).toEqual(expect.any(Function));
    expect(governance.compareCapabilityVersions).toEqual(expect.any(Function));
    expect(governance.analyzeCapabilityImpact).toEqual(expect.any(Function));
    expect(governance.loadGovernanceGateConfig).toEqual(expect.any(Function));
    expect(governance.runGovernanceGate).toEqual(expect.any(Function));
    expect(governance.formatGovernanceGateReport).toEqual(expect.any(Function));
  });

  it("evaluates lifecycle transitions and fail-closed blockers", async () => {
    const registry = await exampleRegistry();

    const disable = evaluateLifecycleTransition(registry, {
      capabilityId: "support.refund.prepare_case",
      from: "production",
      reason: "Safety pause",
      to: "disabled"
    });
    expect(disable.allowed).toBe(true);

    const removed = evaluateLifecycleTransition(registry, {
      capabilityId: "support.refund.prepare_case",
      from: "removed",
      reason: "Attempt restore",
      to: "production"
    });
    expect(removed.allowed).toBe(false);
    expect(removed.reasons.map((reason) => reason.code)).toContain("removed_terminal");

    const missingOwnerCapability = cloneCapability(mustCapability(registry, "support.ticket.get"));
    delete missingOwnerCapability.owner;
    const missingOwnerRegistry = buildRegistry([loadedCapability(missingOwnerCapability)]);
    const draftToReview = evaluateLifecycleTransition(missingOwnerRegistry, {
      capabilityId: missingOwnerCapability.id,
      from: "draft",
      reason: "Ready for review",
      to: "review"
    });
    expect(draftToReview.allowed).toBe(false);
    expect(draftToReview.requiredActions.map((action) => action.code)).toContain("owner_required");

    const productionDeprecated = evaluateLifecycleTransition(registry, {
      capabilityId: "support.ticket.get",
      from: "production",
      reason: "Retire old lookup",
      to: "deprecated"
    });
    expect(productionDeprecated.allowed).toBe(false);
    expect(productionDeprecated.requiredActions.map((action) => action.code)).toContain("migration_notes_required");

    const emergencyDeprecated = evaluateLifecycleTransition(registry, {
      capabilityId: "support.ticket.get",
      from: "production",
      override: {
        approvedBy: "release-owner",
        emergency: true,
        reason: "Emergency retirement"
      },
      reason: "Emergency retirement",
      to: "deprecated"
    });
    expect(emergencyDeprecated.allowed).toBe(true);
  });

  it("compiles inferred risk and required controls", async () => {
    const registry = await exampleRegistry();
    const entities = registry.entities.map((entity) => entity.manifest);

    const read = compileCapabilityRisk(mustCapability(registry, "support.ticket.get"), { entities });
    expect(read.passed).toBe(true);
    expect(read.inferredMinimumRiskTier).toBe("low");

    const prepare = compileCapabilityRisk(mustCapability(registry, "support.refund.prepare_case"), { entities });
    expect(prepare.passed).toBe(true);

    const prepareWithoutIdempotency = cloneCapability(mustCapability(registry, "support.refund.prepare_case"));
    delete prepareWithoutIdempotency.idempotency;
    const missingIdempotency = compileCapabilityRisk(prepareWithoutIdempotency, { entities });
    expect(missingIdempotency.passed).toBe(false);
    expect(missingIdempotency.reasons.map((reason) => reason.code)).toContain("idempotency_required");

    const criticalCommit = compileCapabilityRisk(mustCapability(registry, "support.refund.commit_case"), { entities });
    expect(criticalCommit.passed).toBe(true);
    expect(criticalCommit.inferredMinimumRiskTier).toBe("critical");

    const incompleteCritical = cloneCapability(mustCapability(registry, "support.refund.commit_case"));
    delete incompleteCritical.extensions;
    const incompleteCriticalRisk = compileCapabilityRisk(incompleteCritical, { entities });
    expect(incompleteCriticalRisk.passed).toBe(false);
    expect(incompleteCriticalRisk.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "retention_policy_required",
      "security_pack_required"
    ]));

    const oldPrepare = cloneCapability(mustCapability(registry, "support.refund.prepare_case"));
    delete oldPrepare.idempotency;
    const oldPrepareRisk = compileCapabilityRisk(oldPrepare, { entities });
    expect(oldPrepareRisk.reasons.map((reason) => reason.code)).toContain("idempotency_required");

    const irreversible = cloneCapability(mustCapability(registry, "support.refund.commit_case"));
    irreversible.risk_tier = "high";
    irreversible.side_effects.irreversible = true;
    const irreversibleRisk = compileCapabilityRisk(irreversible, { entities });
    expect(irreversibleRisk.passed).toBe(false);
    expect(irreversibleRisk.inferredMinimumRiskTier).toBe("critical");
    expect(irreversibleRisk.reasons.map((reason) => reason.code)).toContain("irreversible_critical_risk_required");
  });

  it("classifies compatibility changes", async () => {
    const registry = await exampleRegistry();
    const base = cloneCapability(mustCapability(registry, "support.ticket.get"));

    const optionalInput = cloneCapability(base);
    optionalInput.version = "1.1.0";
    schemaProperties(optionalInput).priority = { type: "string" };
    expect(compareCapabilityVersions(base, optionalInput).compatibility).toBe("requires_minor");

    const requiredInput = cloneCapability(optionalInput);
    requiredInput.input_schema.required = [...schemaRequired(requiredInput), "priority"];
    expect(compareCapabilityVersions(base, requiredInput).compatibility).toBe("breaking");

    const loweredRisk = cloneCapability(mustCapability(registry, "support.refund.commit_case"));
    loweredRisk.version = "1.0.1";
    loweredRisk.risk_tier = "medium";
    expect(compareCapabilityVersions(mustCapability(registry, "support.refund.commit_case"), loweredRisk).compatibility).toBe("breaking");

    const stricterApproval = cloneCapability(base);
    stricterApproval.version = "1.1.0";
    stricterApproval.policy.approval_required = true;
    expect(compareCapabilityVersions(base, stricterApproval).compatibility).toBe("requires_minor");

    const addedSideEffect = cloneCapability(base);
    addedSideEffect.version = "2.0.0";
    addedSideEffect.side_effects.writes_data = true;
    expect(compareCapabilityVersions(base, addedSideEffect).compatibility).toBe("breaking");

    const docsOnly = cloneCapability(base);
    docsOnly.version = "1.0.1";
    docsOnly.summary = "Read a synthetic ticket for support review.";
    expect(compareCapabilityVersions(base, docsOnly).compatibility).toBe("compatible");
  });

  it("analyzes direct registry impact and missing coverage", async () => {
    const registry = await exampleRegistry();
    const report = analyzeCapabilityImpact(registry, "support.refund.prepare_case");

    expect(report.affectedCapabilities).toContain("support.refund.commit_case");
    expect(report.affectedEntities).toEqual(["Order", "Ticket"]);
    expect(report.affectedEvalSuites).toContain("support.refund.prepare_case.valid");
    expect(report.affectedPolicies).toContain("permission:refund.case.create");
    expect(report.affectedProviders).toContain("openai");

    const unknown = analyzeCapabilityImpact(registry, "support.unknown.missing");
    expect(unknown.missingCoverage[0]?.code).toBe("capability_unknown");
    expect(unknown.missingCoverage[0]?.severity).toBe("blocking");
  });

  it("runs governance CLI text and JSON commands", async () => {
    const risk = await runWithBuffers(["governance", "risk", "examples", "--capability", "support.ticket.get"]);
    expect(risk.exitCode).toBe(0);
    expect(risk.stdout).toContain("AICF Governance Risk");
    expect(risk.stdout).toContain("support.ticket.get");

    const impact = await runWithBuffers(["governance", "impact", "examples", "--capability", "support.refund.prepare_case", "--format", "json"]);
    expect(impact.exitCode).toBe(0);
    expect(JSON.parse(impact.stdout)).toEqual(expect.objectContaining({
      capabilityId: "support.refund.prepare_case"
    }));

    const lifecycle = await runWithBuffers([
      "governance",
      "lifecycle",
      "examples",
      "--capability",
      "support.ticket.get",
      "--from",
      "production",
      "--to",
      "deprecated",
      "--reason",
      "Retire old lookup"
    ]);
    expect(lifecycle.exitCode).toBe(1);
    expect(lifecycle.stdout).toContain("migration_notes_required");
  });

  it("loads governance gate config and validates gate reports", async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-gate-config-"));
    try {
      const fallback = await loadGovernanceGateConfig(tempDirectory);
      expect(fallback.path).toBeUndefined();
      expect(fallback.diagnostics).toEqual([]);
      expect(fallback.config.schema_version).toBe("1.0");

      const configPath = path.join(tempDirectory, "aicf.config.yaml");
      await writeFile(configPath, [
        'schema_version: "1.0"',
        "project:",
        "  name: synthetic-gate",
        "  environment: production",
        "providers:",
        "  enabled:",
        "    - openai"
      ].join("\n"), "utf8");
      const explicit = await loadGovernanceGateConfig(tempDirectory, { configPath });
      expect(explicit.diagnostics).toEqual([]);
      expect(explicit.path).toContain("aicf.config.yaml");

      const invalidPath = path.join(tempDirectory, "invalid.config.yaml");
      await writeFile(invalidPath, 'schema_version: "0.9"\n', "utf8");
      const invalid = await loadGovernanceGateConfig(tempDirectory, { configPath: invalidPath });
      expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: "schema" }));
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }

    const report = await runGovernanceGate({ environment: "production", manifestRoot: "examples" });
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const schema = JSON.parse(await readFile("schemas/governance/gate-report.schema.json", "utf8")) as Record<string, unknown>;
    const validate = ajv.compile(schema);

    expect(report.exitCode).toBe(0);
    expect(validate(report)).toBe(true);
    expect(formatGovernanceGateReport(report, "text")).toContain("AICF governance gate passed");
    expect(JSON.parse(formatGovernanceGateReport(report, "json"))).toEqual(expect.objectContaining({
      schema_version: "1.0"
    }));
  });

  it("runs governance gate CLI with stable success, warning, and usage exit codes", async () => {
    const success = await runWithBuffers(["gate", "examples", "--env", "production", "--format", "json"]);
    expect(success.exitCode).toBe(0);
    expect(JSON.parse(success.stdout)).toEqual(expect.objectContaining({
      exitCode: 0,
      passed: true
    }));

    const warningsFail = await runWithBuffers(["gate", "examples", "--env", "production", "--fail-on-warnings"]);
    expect(warningsFail.exitCode).toBe(1);
    expect(warningsFail.stdout).toContain("warning: impact");

    const missingPath = await runWithBuffers(["gate"]);
    expect(missingPath.exitCode).toBe(2);
    expect(missingPath.stderr).toContain("Missing required <manifest-root>");

    const invalidConfigDirectory = await mkdtemp(path.join(tmpdir(), "aicf-gate-invalid-config-"));
    try {
      const invalidConfigPath = path.join(invalidConfigDirectory, "aicf.config.yaml");
      await writeFile(invalidConfigPath, 'schema_version: "1.0"\nproviders:\n  enabled:\n    - unknown-provider\n', "utf8");
      const invalidConfig = await runWithBuffers(["gate", "examples", "--config", invalidConfigPath, "--format", "json"]);
      expect(invalidConfig.exitCode).toBe(2);
      expect(JSON.parse(invalidConfig.stdout)).toEqual(expect.objectContaining({
        exitCode: 2,
        passed: false
      }));
    } finally {
      await rm(invalidConfigDirectory, { force: true, recursive: true });
    }
  });

  it("reports governance gate blockers for risk, eval coverage, deprecated status, compatibility, providers, and artifacts", async () => {
    const registry = await exampleRegistry();

    const incompleteCritical = cloneCapability(mustCapability(registry, "support.refund.commit_case"));
    delete incompleteCritical.evals;
    delete incompleteCritical.extensions;
    const riskRoot = await writeCapabilityRoot([incompleteCritical]);
    try {
      const riskReport = await runGovernanceGate({
        config: quietGateConfig({
          require_evals_for: [],
          require_security_packs_for: ["critical"]
        }),
        environment: "production",
        manifestRoot: riskRoot
      });
      expect(riskReport.exitCode).toBe(1);
      expect(riskReport.failures.join("\n")).toContain("security_pack");
    } finally {
      await rm(riskRoot, { force: true, recursive: true });
    }

    const missingEval = cloneCapability(mustCapability(registry, "support.refund.prepare_case"));
    delete missingEval.evals;
    delete missingEval.lifecycle.commit_capability_id;
    const evalRoot = await writeCapabilityRoot([missingEval]);
    try {
      const evalReport = await runGovernanceGate({
        config: quietGateConfig({
          require_evals_for: ["medium"],
          require_security_packs_for: []
        }),
        environment: "production",
        manifestRoot: evalRoot
      });
      expect(evalReport.failures.join("\n")).toContain("eval coverage is required");
    } finally {
      await rm(evalRoot, { force: true, recursive: true });
    }

    const deprecated = cloneCapability(mustCapability(registry, "support.ticket.get"));
    deprecated.status = "deprecated";
    const deprecatedRoot = await writeCapabilityRoot([deprecated]);
    try {
      const blocked = await runGovernanceGate({
        config: quietGateConfig({ block_deprecated_capabilities: true }),
        environment: "production",
        manifestRoot: deprecatedRoot
      });
      const allowed = await runGovernanceGate({
        config: quietGateConfig({ block_deprecated_capabilities: false }),
        environment: "production",
        manifestRoot: deprecatedRoot
      });
      expect(blocked.failures.join("\n")).toContain("deprecated capabilities are blocked");
      expect(allowed.exitCode).toBe(0);
    } finally {
      await rm(deprecatedRoot, { force: true, recursive: true });
    }

    const before = cloneCapability(mustCapability(registry, "support.ticket.get"));
    const after = cloneCapability(before);
    after.version = "2.0.0";
    schemaProperties(after).priority = { type: "string" };
    after.input_schema.required = [...schemaRequired(after), "priority"];
    const baselineRoot = await writeCapabilityRoot([before]);
    const currentRoot = await writeCapabilityRoot([after]);
    try {
      const compatibility = await runGovernanceGate({
        baselineRoot,
        config: quietGateConfig(),
        environment: "production",
        manifestRoot: currentRoot
      });
      expect(compatibility.failures.join("\n")).toContain("breaking compatibility change");
    } finally {
      await rm(baselineRoot, { force: true, recursive: true });
      await rm(currentRoot, { force: true, recursive: true });
    }

    const providerReport = await runGovernanceGate({
      config: {
        schema_version: "1.0",
        providers: { enabled: ["not-a-provider"] },
        gates: {
          production: {
            require_conformance_for_enabled_providers: true
          }
        }
      } as unknown as GovernanceGateConfig,
      environment: "production",
      manifestRoot: "examples"
    });
    expect(providerReport.exitCode).toBe(2);
    expect(providerReport.failures.join("\n")).toContain("Unknown provider");

    const artifactRoot = await writeCapabilityRoot([cloneCapability(mustCapability(registry, "support.ticket.get"))]);
    try {
      await mkdir(path.join(artifactRoot, "_private"), { recursive: true });
      await writeFile(path.join(artifactRoot, "_private", "notes.txt"), "private draft", "utf8");
      const artifactReport = await runGovernanceGate({
        config: quietGateConfig({ artifact_hygiene: true }),
        environment: "production",
        manifestRoot: artifactRoot
      });
      expect(artifactReport.failures.join("\n")).toContain("Forbidden path included");
    } finally {
      await rm(artifactRoot, { force: true, recursive: true });
    }
  });

  it("runs governance compatibility CLI against standalone files", async () => {
    const registry = await exampleRegistry();
    const base = cloneCapability(mustCapability(registry, "support.ticket.get"));
    const changed = cloneCapability(base);
    changed.version = "2.0.0";
    changed.input_schema.required = [...schemaRequired(changed), "priority"];
    schemaProperties(changed).priority = { type: "string" };

    const tempDirectory = await mkdtemp(path.join(tmpdir(), "aicf-governance-"));
    try {
      const beforePath = path.join(tempDirectory, "before.json");
      const afterPath = path.join(tempDirectory, "after.json");
      await writeFile(beforePath, JSON.stringify(base), "utf8");
      await writeFile(afterPath, JSON.stringify(changed), "utf8");

      const result = await runWithBuffers(["governance", "compatibility", "--before", beforePath, "--after", afterPath, "--format", "json"]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        compatibility: "breaking"
      }));
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });
});

async function exampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  return buildRegistry(loaded.manifests);
}

function mustCapability(registry: ManifestRegistry, capabilityId: string): CapabilityManifest {
  const capability = registry.capabilityById.get(capabilityId)?.manifest;
  if (!capability) {
    throw new Error(`Missing test capability ${capabilityId}.`);
  }
  return capability;
}

function cloneCapability(capability: CapabilityManifest): CapabilityManifest {
  return JSON.parse(JSON.stringify(capability)) as CapabilityManifest;
}

function loadedCapability(capability: CapabilityManifest): LoadedCapabilityManifest {
  return {
    absolutePath: `${capability.id}.yaml`,
    kind: "capability",
    manifest: capability,
    path: `${capability.id}.yaml`
  };
}

function schemaProperties(capability: CapabilityManifest): Record<string, unknown> {
  const schema = capability.input_schema as Record<string, unknown>;
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    schema.properties = {};
  }
  return schema.properties as Record<string, unknown>;
}

function schemaRequired(capability: CapabilityManifest): string[] {
  return Array.isArray(capability.input_schema.required)
    ? capability.input_schema.required.filter((value): value is string => typeof value === "string")
    : [];
}

async function writeCapabilityRoot(capabilities: CapabilityManifest[]): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "aicf-gate-manifests-"));
  const capabilitiesDirectory = path.join(directory, "capabilities");
  await mkdir(capabilitiesDirectory, { recursive: true });
  for (const capability of capabilities) {
    await writeFile(
      path.join(capabilitiesDirectory, `${capability.id}.json`),
      JSON.stringify(capability, null, 2),
      "utf8"
    );
  }
  return directory;
}

function quietGateConfig(overrides: Partial<GovernanceGateEnvironmentConfig> = {}): GovernanceGateConfig {
  return {
    gates: {
      production: {
        artifact_hygiene: false,
        block_deprecated_capabilities: false,
        fail_on_warnings: false,
        require_conformance_for_enabled_providers: false,
        require_evals_for: [],
        require_security_packs_for: [],
        ...overrides
      }
    },
    schema_version: "1.0"
  };
}

async function runWithBuffers(argv: string[]): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const stdout = createWritableBuffer();
  const stderr = createWritableBuffer();
  const exitCode = await runCli(argv, { stderr, stdout });
  return {
    exitCode,
    stderr: stderr.value,
    stdout: stdout.value
  };
}

function createWritableBuffer(): { value: string; write: (message: string) => void } {
  return {
    value: "",
    write(message: string) {
      this.value += message;
    }
  };
}
