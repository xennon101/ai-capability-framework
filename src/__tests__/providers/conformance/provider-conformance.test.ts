import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  runCli,
  validateManifests,
  validatePublicFixtures,
  type LoadedCapabilityManifest,
  type ManifestRegistry
} from "../../../index.js";
import {
  exportProviderTools,
  formatProviderConformanceReport,
  listProviderTargets,
  runProviderConformanceSuite,
  type ProviderConformanceTarget
} from "../../../providers/conformance/index.js";

const supportContext = {
  autonomyTier: "A2" as const,
  permissions: ["ticket.read", "refund.case.create"],
  riskCeiling: "medium" as const,
  tenantId: "tenant_example_support",
  userId: "user_example_support_agent"
};

describe("provider conformance matrix", () => {
  it("lists all supported provider targets", () => {
    expect(listProviderTargets().map((target) => target.provider)).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "ai-sdk",
      "langchain",
      "mcp",
      "semantic-kernel"
    ]);
  });

  it("exports read and prepare tools for every provider without commit tools", async () => {
    const registry = await loadExampleRegistry();
    const providers: ProviderConformanceTarget[] = ["openai", "anthropic", "gemini", "ai-sdk", "langchain", "mcp", "semantic-kernel"];

    for (const provider of providers) {
      const exported = exportProviderTools({
        capabilityIds: ["support.ticket.get", "support.refund.prepare_case", "support.refund.commit_case"],
        context: supportContext,
        includeDiagnostics: true,
        provider,
        registry,
        serverUrl: "https://aicf.example.com"
      });

      expect(exported.provider, provider).toBe(provider);
      expect(exported.exportedCount, provider).toBeGreaterThan(0);
      expect(exported.bindings.map((binding) => binding.capabilityId).sort(), provider).toEqual([
        "support.refund.prepare_case",
        "support.ticket.get",
      ]);
      expect(exported.bindings.some((binding) => binding.capabilityId === "support.refund.commit_case"), provider).toBe(false);
    }
  });

  it("runs a passing default conformance suite and formats reports", async () => {
    const registry = await loadExampleRegistry();
    const report = runProviderConformanceSuite({
      registry,
      serverUrl: "https://aicf.example.com"
    });

    expect(report.passed).toBe(true);
    expect(report.counts.providers).toBe(7);
    expect(report.results.length).toBeGreaterThan(0);
    expect(formatProviderConformanceReport(report, "text")).toContain("Provider conformance passed");
    expect(JSON.parse(formatProviderConformanceReport(report, "json"))).toMatchObject({
      passed: true
    });
  });

  it("reports structured failures for invalid args, missing context, collisions, and unsupported schemas", async () => {
    const registry = await loadExampleRegistry();
    const invalidArgs = runProviderConformanceSuite({
      cases: [{
        capabilityIds: ["support.ticket.get"],
        expected: {
          canonicalToolCalls: [{
            argsSubset: {
              ticket_id: "not-valid"
            },
            capabilityId: "support.ticket.get"
          }]
        },
        id: "invalid.args",
        input: "Read a bad ticket."
      }],
      providers: ["openai"],
      registry
    });
    const missingContext = exportProviderTools({
      capabilityIds: ["support.ticket.get"],
      context: {
        autonomyTier: "A1",
        permissions: ["ticket.read"]
      },
      includeDiagnostics: true,
      provider: "openai",
      registry
    });
    const collisionRegistry = buildRegistry([
      cloneCapability(registry, "support.ticket.get", "support.alpha_case.get"),
      cloneCapability(registry, "support.ticket.get", "support.alpha.case_get")
    ]);
    const collision = exportProviderTools({
      context: supportContext,
      includeDiagnostics: true,
      provider: "openai",
      registry: collisionRegistry
    });
    const unsupportedRegistry = buildRegistry([
      cloneCapability(registry, "support.ticket.get", "support.ticket.unsupported", {
        input_schema: {
          additionalProperties: false,
          properties: {
            ticket_id: {
              anyOf: [
                { type: "string" },
                { type: "number" }
              ]
            }
          },
          required: ["ticket_id"],
          type: "object"
        }
      })
    ]);
    const unsupported = exportProviderTools({
      context: supportContext,
      includeDiagnostics: true,
      provider: "openai",
      registry: unsupportedRegistry
    });

    expect(invalidArgs.passed).toBe(false);
    expect(invalidArgs.results[0]?.diagnostics).toContain("Args subset failed schema for support.ticket.get.");
    expect(missingContext.exportedCount).toBe(0);
    expect(missingContext.diagnostics).toContainEqual(expect.objectContaining({
      code: "capability_excluded",
      id: "support.ticket.get"
    }));
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({
      code: "tool_name_collision",
      id: "support.alpha.case_get"
    }));
    expect(unsupported.diagnostics).toContainEqual(expect.objectContaining({
      code: "unsupported",
      id: "support.ticket.unsupported"
    }));
  });

  it("preserves correlation scorer and safe error/no raw payload checks", async () => {
    const registry = await loadExampleRegistry();
    const report = runProviderConformanceSuite({
      cases: [{
        capabilityIds: ["support.ticket.get"],
        expected: {
          canonicalToolCalls: [{
            argsSubset: {
              ticket_id: "TCK-100"
            },
            capabilityId: "support.ticket.get"
          }]
        },
        id: "correlation.fixture",
        input: "Read ticket TCK-100.",
        mockProviderResponses: [{
          call_id: "call_provider_1"
        }]
      }],
      providers: ["openai"],
      registry
    });

    expect(report.results[0]?.scorers).toContainEqual(expect.objectContaining({
      passed: true,
      scorer: "provider_result_correlation_preserved"
    }));
    expect(report.results[0]?.scorers).toContainEqual(expect.objectContaining({
      passed: true,
      scorer: "provider_safe_error_envelope"
    }));
    expect(report.results[0]?.scorers).toContainEqual(expect.objectContaining({
      passed: true,
      scorer: "no_raw_payload_logged"
    }));
  });

  it("supports providers CLI list, export, Semantic Kernel OpenAPI, and conformance commands", async () => {
    const contextPath = await writeTempJson("provider-context", supportContext);
    const list = createWritableBuffer();
    const exportOut = createWritableBuffer();
    const semanticOut = createWritableBuffer();
    const conformanceOut = createWritableBuffer();

    expect(await runCli(["providers", "list"], { stdout: list })).toBe(0);
    expect(list.value).toContain("\"openai\"");

    expect(await runCli(["providers", "export-tools", "examples", "--provider", "openai", "--context", contextPath], {
      stdout: exportOut
    })).toBe(0);
    expect(exportOut.value).toContain("support.ticket.get");

    expect(await runCli(["providers", "export-semantic-kernel-openapi", "examples", "--context", contextPath, "--server-url", "https://aicf.example.com"], {
      stdout: semanticOut
    })).toBe(0);
    expect(semanticOut.value).toContain("\"openapi\"");

    expect(await runCli(["providers", "conformance", "examples", "--format", "json"], {
      stdout: conformanceOut
    })).toBe(0);
    expect(JSON.parse(conformanceOut.value)).toMatchObject({
      passed: true
    });
  });

  it("returns nonzero CLI exits for collision and unsafe commit-only exports", async () => {
    const registry = await loadExampleRegistry();
    const contextPath = await writeTempJson("provider-context", supportContext);
    const commitOnlyContextPath = await writeTempJson("provider-commit-context", {
      autonomyTier: "A0",
      permissions: ["refund.case.commit"],
      tenantId: "tenant_example_support",
      userId: "user_example_support_lead"
    });
    const collisionRoot = await writeCollisionFixture(registry);
    const collisionErr = createWritableBuffer();
    const commitErr = createWritableBuffer();

    expect(await runCli(["providers", "export-tools", collisionRoot, "--provider", "openai", "--context", contextPath], {
      stderr: collisionErr
    })).toBe(1);
    expect(collisionErr.value).toContain("collides");

    expect(await runCli(["providers", "export-tools", "examples/support", "--provider", "openai", "--context", commitOnlyContextPath], {
      stderr: commitErr
    })).toBe(1);
    expect(commitErr.value).toContain("No openai provider tools were exportable");
  });
});

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const manifestValidation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);
  const errors = [
    ...loaded.errors,
    ...manifestValidation.errors,
    ...fixtureValidation.errors
  ];
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  return buildRegistry(loaded.manifests);
}

function mustCapability(registry: ManifestRegistry, capabilityId: string): LoadedCapabilityManifest {
  const capability = registry.capabilityById.get(capabilityId);
  if (!capability) {
    throw new Error(`Missing capability ${capabilityId}`);
  }
  return capability;
}

function cloneCapability(
  registry: ManifestRegistry,
  sourceCapabilityId: string,
  nextCapabilityId: string,
  overrides: Partial<LoadedCapabilityManifest["manifest"]> = {}
): LoadedCapabilityManifest {
  const source = mustCapability(registry, sourceCapabilityId);
  return {
    ...source,
    manifest: {
      ...JSON.parse(JSON.stringify(source.manifest)) as LoadedCapabilityManifest["manifest"],
      ...overrides,
      id: nextCapabilityId
    },
    path: `${nextCapabilityId}.json`
  };
}

async function writeCollisionFixture(registry: ManifestRegistry): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aicf-provider-collision-"));
  const capabilityDir = path.join(root, "capabilities");
  await mkdir(capabilityDir, { recursive: true });
  await writeFile(
    path.join(capabilityDir, "one.json"),
    JSON.stringify(cloneCapability(registry, "support.ticket.get", "support.alpha_case.get").manifest, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(capabilityDir, "two.json"),
    JSON.stringify(cloneCapability(registry, "support.ticket.get", "support.alpha.case_get").manifest, null, 2),
    "utf8"
  );
  return root;
}

async function writeTempJson(prefix: string, value: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `aicf-${prefix}-`));
  const filePath = path.join(root, "fixture.json");
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
}

function createWritableBuffer() {
  return {
    value: "",
    write(message: string) {
      this.value += message;
    }
  };
}
