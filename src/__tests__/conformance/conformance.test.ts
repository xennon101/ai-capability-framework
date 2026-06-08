import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  validateManifests,
  validatePublicFixtures,
  type LoadedCapabilityManifest,
  type ManifestRegistry
} from "../../index.js";
import { runCli } from "../../cli.js";
import {
  buildConformanceMatrix,
  exportConformanceProviderTools,
  formatConformanceMatrix,
  listConformanceTargets,
  normalizeProviderConformanceTarget,
  parseProviderConformanceTargets,
  runConformanceSuite
} from "../../conformance/index.js";

const supportContext = {
  autonomyTier: "A2" as const,
  permissions: ["ticket.read", "refund.case.create"],
  riskCeiling: "medium" as const,
  tenantId: "tenant_example_support",
  userId: "user_example_support_agent"
};

describe("root conformance facade", () => {
  it("exports the canonical conformance API from the built subpath", async () => {
    const built = await import("../../../dist/conformance/index.js") as Record<string, unknown>;

    for (const exportName of [
      "buildConformanceMatrix",
      "exportConformanceProviderTools",
      "formatConformanceMatrix",
      "listConformanceTargets",
      "runConformanceSuite",
      "runProviderConformanceSuite"
    ]) {
      expect(built[exportName], exportName).toEqual(expect.any(Function));
    }
  });

  it("normalizes aliases and emits the canonical target matrix", () => {
    const parsed = parseProviderConformanceTargets("openai,vercel-ai-sdk,vercel_ai_sdk,semantic-kernel,semantic-kernel-mcp");
    const matrix = buildConformanceMatrix({ providers: parsed.providers });

    expect(parsed.errors).toEqual([]);
    expect(parsed.providers).toEqual(["openai", "ai-sdk", "semantic-kernel-openapi", "semantic-kernel-mcp"]);
    expect(normalizeProviderConformanceTarget("semantic-kernel")).toBe("semantic-kernel-openapi");
    expect(listConformanceTargets().map((target) => target.provider)).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "ai-sdk",
      "langchain",
      "mcp",
      "semantic-kernel-mcp",
      "semantic-kernel-openapi"
    ]);
    expect(formatConformanceMatrix(matrix, "markdown")).toContain("| semantic-kernel-openapi | Semantic Kernel OpenAPI |");
  });

  it("produces schema-valid reports and matrices with backwards-compatible aliases", async () => {
    const registry = await loadExampleRegistry();
    const report = runConformanceSuite({
      generatedAt: "2026-06-05T00:00:00.000Z",
      providers: ["openai", "anthropic", "mcp", "semantic-kernel-openapi"],
      registry,
      serverUrl: "https://aicf.example.com"
    });
    const matrix = buildConformanceMatrix({
      generatedAt: "2026-06-05T00:00:00.000Z"
    });
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const reportSchema = JSON.parse(await readFile("schemas/conformance/conformance-report.schema.json", "utf8"));
    const matrixSchema = JSON.parse(await readFile("schemas/conformance/provider-target-matrix.schema.json", "utf8"));

    expect(report.schemaVersion).toBe("1.0");
    expect(report.passed).toBe(true);
    expect(report.counts.providers).toBe(4);
    expect(report.summary.providers).toBe(4);
    expect(report.providerResults.map((result) => result.provider)).toEqual([
      "openai",
      "anthropic",
      "mcp",
      "semantic-kernel-openapi"
    ]);
    expect(ajv.compile(reportSchema)(report)).toBe(true);
    expect(ajv.compile(matrixSchema)(matrix)).toBe(true);
  });

  it("exports read and prepare tools for canonical targets while excluding commit tools", async () => {
    const registry = await loadExampleRegistry();

    for (const provider of ["openai", "anthropic", "gemini", "ai-sdk", "langchain", "mcp", "semantic-kernel-mcp", "semantic-kernel-openapi"] as const) {
      const exported = exportConformanceProviderTools({
        capabilityIds: ["support.ticket.get", "support.refund.prepare_case", "support.refund.commit_case"],
        context: supportContext,
        includeDiagnostics: true,
        provider,
        registry,
        serverUrl: "https://aicf.example.com"
      });

      expect(exported.exportedCount, provider).toBeGreaterThan(0);
      expect(exported.bindings.some((binding) => binding.capabilityId === "support.refund.commit_case"), provider).toBe(false);
      expect(exported.bindings.map((binding) => binding.capabilityId).sort(), provider).toEqual([
        "support.refund.prepare_case",
        "support.ticket.get"
      ]);
    }
  });

  it("runs the new conformance CLI commands and the provider compatibility alias", async () => {
    const outRoot = await mkdtemp(path.join(tmpdir(), "aicf-conformance-cli-"));
    const runOut = path.join(outRoot, "report.json");
    const matrixOut = path.join(outRoot, "matrix.md");
    const stdout = createWritableBuffer();
    const matrixStdout = createWritableBuffer();
    const aliasStdout = createWritableBuffer();

    expect(await runCli(["conformance", "run", "examples", "--format", "json"], { stdout })).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      schemaVersion: "1.0",
      passed: true
    });

    expect(await runCli([
      "conformance",
      "run",
      "examples",
      "--providers",
      "openai,anthropic,mcp",
      "--format",
      "json",
      "--out",
      runOut
    ], { stdout: createWritableBuffer() })).toBe(0);
    expect(JSON.parse(await readFile(runOut, "utf8")).counts.providers).toBe(3);

    expect(await runCli([
      "conformance",
      "matrix",
      "examples",
      "--format",
      "markdown",
      "--out",
      matrixOut
    ], { stdout: matrixStdout })).toBe(0);
    expect(await readFile(matrixOut, "utf8")).toContain("| openai | OpenAI Responses |");

    expect(await runCli(["providers", "conformance", "examples", "--format", "json"], { stdout: aliasStdout })).toBe(0);
    expect(JSON.parse(aliasStdout.value).schemaVersion).toBe("1.0");
  });

  it("fails closed for unknown providers and unsupported provider schemas", async () => {
    const unknownErr = createWritableBuffer();
    const unsupportedRoot = await writeUnsupportedFixture(await loadExampleRegistry());
    const unsupportedOut = createWritableBuffer();

    expect(await runCli(["conformance", "run", "examples", "--providers", "unknown-provider"], {
      stderr: unknownErr
    })).toBe(1);
    expect(unknownErr.value).toContain("Unknown provider");

    expect(await runCli(["conformance", "run", unsupportedRoot, "--providers", "openai", "--format", "json"], {
      stdout: unsupportedOut
    })).toBe(1);
    expect(unsupportedOut.value).toContain("unsupported");
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

function cloneCapability(
  registry: ManifestRegistry,
  sourceCapabilityId: string,
  overrides: Partial<LoadedCapabilityManifest["manifest"]> = {}
): LoadedCapabilityManifest["manifest"] {
  const source = registry.capabilityById.get(sourceCapabilityId);
  if (!source) {
    throw new Error(`Missing capability ${sourceCapabilityId}`);
  }
  return {
    ...JSON.parse(JSON.stringify(source.manifest)) as LoadedCapabilityManifest["manifest"],
    ...overrides
  };
}

async function writeUnsupportedFixture(registry: ManifestRegistry): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "aicf-conformance-unsupported-"));
  const capabilityDir = path.join(root, "capabilities");
  await mkdir(capabilityDir, { recursive: true });
  await writeFile(
    path.join(capabilityDir, "ticket.json"),
    JSON.stringify(cloneCapability(registry, "support.ticket.get", {
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
    }), null, 2),
    "utf8"
  );
  return root;
}

function createWritableBuffer() {
  return {
    value: "",
    write(message: string) {
      this.value += message;
    }
  };
}
