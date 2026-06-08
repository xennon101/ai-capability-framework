import Ajv2020 from "ajv/dist/2020.js";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { runCli } from "../../cli.js";
import { loadManifests } from "../../loader.js";
import { buildRegistry } from "../../registry.js";
import {
  assessSecurityPackCoverage,
  exportPromptfooRedTeamConfig,
  exportPromptfooSecurityPackSuite,
  generateSecurityCases,
  listSecurityPacks,
  recommendedPacksForCapability,
  type SecurityPackCoverageReport
} from "../../security-packs/index.js";
import { validateManifests } from "../../validator.js";

const requiredPackIds = [
  "prompt_injection_direct",
  "prompt_injection_indirect",
  "tool_exfiltration",
  "cross_tenant_access",
  "approval_bypass",
  "unsafe_commit_attempt",
  "schema_confusion",
  "capability_spoofing",
  "tool_result_poisoning",
  "sensitive_data_disclosure",
  "insecure_output_rendering",
  "cost_amplification",
  "provider_payload_exposure",
  "mcp_tool_abuse",
  "retrieval_poisoning",
  "memory_scope_violation"
] as const;

describe("security packs", () => {
  it("exports security-pack APIs from the built package subpath", async () => {
    const securityPacks = await import("../../../dist/security-packs/index.js") as Record<string, unknown>;

    expect(securityPacks.listSecurityPacks).toEqual(expect.any(Function));
    expect(securityPacks.generateSecurityCases).toEqual(expect.any(Function));
    expect(securityPacks.assessSecurityPackCoverage).toEqual(expect.any(Function));
    expect(securityPacks.exportPromptfooRedTeamConfig).toEqual(expect.any(Function));
  });

  it("lists the built-in public catalog", () => {
    const packIds = listSecurityPacks().map((pack) => pack.id).sort();

    expect(packIds).toEqual([...requiredPackIds].sort());
  });

  it("validates public YAML pack definitions against the schema", async () => {
    const schema = JSON.parse(await readFile("schemas/security-packs/security-pack.schema.json", "utf8")) as Record<string, unknown>;
    const validate = new Ajv2020({ allErrors: true }).compile(schema);
    const files = (await readdir("security-packs")).filter((file) => file.endsWith(".yaml")).sort();

    expect(files).toHaveLength(requiredPackIds.length);
    for (const file of files) {
      const parsed = YAML.parse(await readFile(path.join("security-packs", file), "utf8")) as unknown;
      expect(validate(parsed), `${file}: ${new Ajv2020().errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("generates public-safe security cases for real capabilities", async () => {
    const registry = await loadValidRegistry("examples");
    const suite = generateSecurityCases(registry, {
      packIds: ["approval_bypass"]
    });
    const capabilityIds = new Set(registry.capabilities.map((capability) => capability.manifest.id));

    expect(suite.cases.length).toBeGreaterThan(0);
    expect(suite.cases.some((securityCase) => securityCase.capabilityId === "support.refund.prepare_case")).toBe(true);
    for (const securityCase of suite.cases) {
      expect(capabilityIds.has(securityCase.capabilityId)).toBe(true);
      expect(JSON.stringify(securityCase)).not.toMatch(/_private|Bearer\s+|sk-[A-Za-z0-9]|BEGIN PRIVATE KEY/i);
      expect(securityCase.expected.no_commit).toBe(true);
    }
  });

  it("reports required coverage gaps unless packs are assigned or generated", async () => {
    const registry = await loadValidRegistry("examples");
    const loadedCommit = registry.capabilityById.get("support.refund.commit_case");
    expect(loadedCommit).toBeDefined();
    delete loadedCommit!.manifest.extensions;

    const commitReport = assessSecurityPackCoverage(registry, {
      capabilityIds: ["support.refund.commit_case"]
    });
    const commitItem = itemFor(commitReport, "support.refund.commit_case");

    expect(commitItem.missingRequiredPacks).toEqual(expect.arrayContaining([
      "approval_bypass",
      "cross_tenant_access",
      "prompt_injection_direct",
      "provider_payload_exposure",
      "tool_exfiltration",
      "unsafe_commit_attempt"
    ]));

    loadedCommit!.manifest.extensions = {
      ...(loadedCommit!.manifest.extensions ?? {}),
      governance: {
        security_packs: commitItem.requiredPacks
      }
    };
    const assignedReport = assessSecurityPackCoverage(registry, {
      capabilityIds: ["support.refund.commit_case"]
    });

    expect(itemFor(assignedReport, "support.refund.commit_case").missingRequiredPacks).toEqual([]);
    expect(assignedReport.passed).toBe(true);
  });

  it("recommends packs for refund and scheduling side-effect paths", async () => {
    const registry = await loadValidRegistry("examples");
    const refundPrepare = registry.capabilityById.get("support.refund.prepare_case");
    const refundCommit = registry.capabilityById.get("support.refund.commit_case");
    const schedulingSend = registry.capabilityById.get("scheduling.invite.send");

    expect(refundPrepare).toBeDefined();
    expect(refundCommit).toBeDefined();
    expect(schedulingSend).toBeDefined();
    expect(recommendedPacksForCapability(refundPrepare!)).toContain("approval_bypass");
    expect(recommendedPacksForCapability(refundCommit!)).toEqual(expect.arrayContaining([
      "approval_bypass",
      "unsafe_commit_attempt",
      "provider_payload_exposure"
    ]));
    expect(recommendedPacksForCapability(schedulingSend!)).toEqual(expect.arrayContaining([
      "mcp_tool_abuse",
      "tool_result_poisoning",
      "unsafe_commit_attempt"
    ]));
  });

  it("exports API-key-free Promptfoo red-team config with host placeholders", async () => {
    const registry = await loadValidRegistry("examples");
    const config = exportPromptfooRedTeamConfig(registry);
    const suite = exportPromptfooSecurityPackSuite(registry);
    const yamlFile = suite.files[0]?.content ?? "";
    const parsed = YAML.parse(yamlFile) as Record<string, unknown>;

    expect(config.providers).toEqual(["echo"]);
    expect(yamlFile).toContain("target_endpoint");
    expect(yamlFile).toContain("https://example.com/aicf-runtime");
    expect(yamlFile).toContain("private_diagnostics");
    expect(yamlFile).toContain("raw prompt");
    expect(yamlFile).toContain("provider payload");
    expect(yamlFile).toContain("committed");
    expect(parsed.providers).toEqual(["echo"]);
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer\s+|sk-[A-Za-z0-9]|BEGIN PRIVATE KEY/i);
  });

  it("runs security-pack CLI commands", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-security-packs-"));
    const casesPath = path.join(directory, "cases.yaml");
    const promptfooPath = path.join(directory, "promptfooconfig.yaml");
    const listStdout = createWritableBuffer();
    const listStderr = createWritableBuffer();

    const listExitCode = await runCli(["security", "list-packs", "--format", "json"], {
      stderr: listStderr,
      stdout: listStdout
    });

    expect(listExitCode).toBe(0);
    expect(listStderr.value).toBe("");
    expect(JSON.parse(listStdout.value)).toHaveLength(requiredPackIds.length);

    const generateExitCode = await runCli([
      "security",
      "generate",
      "examples",
      "--pack",
      "approval_bypass",
      "--out",
      casesPath
    ], {
      stderr: createWritableBuffer(),
      stdout: createWritableBuffer()
    });
    const generatedCases = YAML.parse(await readFile(casesPath, "utf8")) as { cases: unknown[] };

    expect(generateExitCode).toBe(0);
    expect(generatedCases.cases.length).toBeGreaterThan(0);

    const exportExitCode = await runCli([
      "security",
      "export-promptfoo",
      "examples",
      "--out",
      promptfooPath
    ], {
      stderr: createWritableBuffer(),
      stdout: createWritableBuffer()
    });

    expect(exportExitCode).toBe(0);
    expect(await readFile(promptfooPath, "utf8")).toContain("echo");
  });

  it("fails CLI commands for unknown packs and no applicable capabilities", async () => {
    const unknownStderr = createWritableBuffer();
    const emptyStderr = createWritableBuffer();
    const directory = await mkdtemp(path.join(tmpdir(), "aicf-security-packs-empty-"));

    const unknownExitCode = await runCli([
      "security",
      "generate",
      "examples",
      "--pack",
      "unknown_pack",
      "--out",
      path.join(directory, "unknown.yaml")
    ], {
      stderr: unknownStderr,
      stdout: createWritableBuffer()
    });
    const emptyExitCode = await runCli([
      "security",
      "generate",
      "conformance/valid",
      "--pack",
      "unsafe_commit_attempt",
      "--out",
      path.join(directory, "empty.yaml")
    ], {
      stderr: emptyStderr,
      stdout: createWritableBuffer()
    });

    expect(unknownExitCode).toBe(1);
    expect(unknownStderr.value).toContain("Unknown security pack id");
    expect(emptyExitCode).toBe(1);
    expect(emptyStderr.value).toContain("No security cases were generated");
  });

  it("keeps root dependencies free of new security-pack runtime packages", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["ajv", "yaml"]);
  });
});

async function loadValidRegistry(root: string) {
  const loaded = await loadManifests({ path: root });
  const validation = validateManifests(loaded.manifests);

  expect(loaded.errors).toEqual([]);
  expect(validation.errors).toEqual([]);
  return buildRegistry(loaded.manifests);
}

function itemFor(report: SecurityPackCoverageReport, capabilityId: string) {
  const item = report.capabilities.find((candidate) => candidate.capabilityId === capabilityId);
  expect(item).toBeDefined();
  return item!;
}

function createWritableBuffer(): { value: string; write(chunk: string): void } {
  return {
    value: "",
    write(chunk: string) {
      this.value += chunk;
    }
  };
}
