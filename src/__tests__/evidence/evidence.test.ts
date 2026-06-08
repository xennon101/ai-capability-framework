import Ajv2020 from "ajv/dist/2020.js";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildRegistry,
  loadManifests,
  loadEvalResults,
  runEvalSuite,
  validateManifests,
  validatePublicFixtures,
  type ManifestRegistry
} from "../../index.js";
import { runCli } from "../../cli.js";
import {
  createEvidencePack,
  evidencePackDisclaimerText,
  exportEvidencePack,
  formatEvidencePackMarkdown,
  validateEvidencePack,
  type EvidencePack
} from "../../evidence/index.js";

describe("evidence export", () => {
  it("exports evidence APIs from the built package subpath", async () => {
    const evidence = await import("../../../dist/evidence/index.js") as Record<string, unknown>;

    expect(evidence.createEvidencePack).toEqual(expect.any(Function));
    expect(evidence.exportEvidencePack).toEqual(expect.any(Function));
    expect(evidence.formatEvidencePackMarkdown).toEqual(expect.any(Function));
    expect(evidence.validateEvidencePack).toEqual(expect.any(Function));
  });

  it("creates schema-valid public-safe evidence packs from examples", async () => {
    const registry = await loadExampleRegistry();
    const pack = createEvidencePack({
      generatedAt: "2026-06-05T00:00:00.000Z",
      project: {
        environment: "production",
        id: "examples",
        name: "AICF Examples"
      },
      registry
    });
    const schema = JSON.parse(await readFile("schemas/evidence/evidence-pack.schema.json", "utf8")) as Record<string, unknown>;
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    const serialized = JSON.stringify(pack);

    expect(validate(pack), new Ajv2020().errorsText(validate.errors)).toBe(true);
    expect(validateEvidencePack(pack)).toEqual({ errors: [], valid: true });
    expect(pack.schemaVersion).toBe("1.0");
    expect(pack.disclaimers.map((disclaimer) => disclaimer.text)).toContain(evidencePackDisclaimerText);
    expect(pack.capabilityInventory.map((item) => item.id)).toContain("support.refund.prepare_case");
    expect(pack.gaps.map((gap) => gap.code)).toContain("eval_results_not_supplied");
    expect(pack.gaps.map((gap) => gap.code)).toContain("conformance_report_not_supplied");
    expect(serialized).not.toMatch(/"rawProviderPayload"\s*:|\bsk-[A-Za-z0-9]{8,}|BEGIN PRIVATE KEY|stack_trace_value|tenant_should_not_escape/i);
  });

  it("summarizes supplied eval results and failed security coverage", async () => {
    const registry = await loadExampleRegistry();
    const loadedResults = await loadEvalResults("examples/eval-results/public.results.passing.json");
    const evalSuiteResult = runEvalSuite(registry, loadedResults.results);
    const pack = createEvidencePack({
      evalSuiteResult,
      generatedAt: "2026-06-05T00:00:00.000Z",
      registry,
      securityReport: {
        capabilities: [{
          assignedPacks: [],
          capabilityId: "support.refund.prepare_case",
          missingRequiredPacks: ["approval_bypass"],
          recommendedPacks: ["approval_bypass"],
          requiredPacks: ["approval_bypass"],
          riskTier: "high",
          validWaivers: [],
          warnings: []
        }],
        generatedAt: "2026-06-05T00:00:00.000Z",
        missingRequired: 1,
        passed: false,
        schema_version: "1.0"
      }
    });

    expect(pack.evalSummary.status).toBe("available");
    expect(pack.evalSummary.passed).toBe(evalSuiteResult.summary.passed);
    expect(pack.securitySummary.missingRequired).toBe(1);
    expect(pack.gaps.map((gap) => gap.code)).toContain("security_pack_coverage_missing");
  });

  it("formats markdown with summaries, gaps, disclaimers, and redaction notes", async () => {
    const registry = await loadExampleRegistry();
    const pack = createEvidencePack({
      generatedAt: "2026-06-05T00:00:00.000Z",
      project: { id: "examples", name: "AICF Examples" },
      registry
    });
    const markdown = formatEvidencePackMarkdown(pack);

    expect(markdown).toContain("# AICF Examples Evidence Pack");
    expect(markdown).toContain("## Disclaimers");
    expect(markdown).toContain("## Coverage Gaps");
    expect(markdown).toContain("support.refund.prepare_case");
    expect(markdown).toContain("redacted_refs_and_hashes_only");
    expect(markdown).not.toMatch(/rawProviderPayload|sk-[A-Za-z0-9]|BEGIN PRIVATE KEY/i);
  });

  it("runs evidence CLI JSON and markdown exports", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-evidence-"));
    const jsonOut = path.join(directory, "evidence-pack.json");
    const markdownOut = path.join(directory, "evidence-pack.md");
    const stdout = createWritableBuffer();
    const markdownStdout = createWritableBuffer();

    expect(await runCli([
      "evidence",
      "export",
      "examples",
      "--out",
      jsonOut,
      "--project-id",
      "examples",
      "--project-name",
      "AICF Examples",
      "--environment",
      "production"
    ], { stdout })).toBe(0);
    const pack = JSON.parse(await readFile(jsonOut, "utf8")) as EvidencePack;
    expect(JSON.parse(stdout.value)).toMatchObject({ format: "json", out: jsonOut });
    expect(validateEvidencePack(pack).valid).toBe(true);
    expect(pack.project.environment).toBe("production");

    expect(await runCli([
      "evidence",
      "export",
      "examples",
      "--format",
      "markdown",
      "--out",
      markdownOut
    ], { stdout: markdownStdout })).toBe(0);
    expect(await readFile(markdownOut, "utf8")).toContain("Evidence Pack");
  });

  it("rejects unsafe evidence output paths", async () => {
    const stderr = createWritableBuffer();

    expect(await runCli([
      "evidence",
      "export",
      "examples",
      "--out",
      "_private/evidence-pack.json"
    ], { stderr })).toBe(1);
    expect(stderr.value).toContain("Evidence output path must not target private");
  });

  it("keeps control-plane evidence compatible while exposing the canonical pack", async () => {
    const registry = await loadExampleRegistry();
    const controlPlane = await import("../../control-plane/index.js");
    const service = controlPlane.createControlPlaneService({
      manifestRoot: "examples",
      registry,
      store: new controlPlane.InMemoryControlPlaneStore()
    });
    const evidence = await controlPlane.exportControlPlaneEvidence({ service });

    expect(evidence.schemaVersion).toBe("1.0");
    expect(evidence.redaction.content).toBe("redacted_refs_and_hashes_only");
    expect(evidence.canonicalEvidence?.schemaVersion).toBe("1.0");
    expect(evidence.canonicalEvidence?.capabilityInventory.length).toBeGreaterThan(0);
  });
});

async function loadExampleRegistry(): Promise<ManifestRegistry> {
  const loaded = await loadManifests({ path: "examples" });
  const validation = validateManifests(loaded.manifests);
  const fixtureValidation = validatePublicFixtures(loaded.fixtures);

  expect([...loaded.errors, ...validation.errors, ...fixtureValidation.errors]).toEqual([]);
  return buildRegistry(loaded.manifests);
}

function createWritableBuffer() {
  return {
    value: "",
    write(message: string) {
      this.value += message;
    }
  };
}
