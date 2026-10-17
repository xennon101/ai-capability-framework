import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public discovery package surface", () => {
  it("uses documented exports, explicit type contracts and supported schema paths", async () => {
    const metadata = JSON.parse(await readFile("package.json", "utf8"));
    const source = await readFile("src/discovery/index.ts", "utf8");
    expect(source).not.toMatch(/export\s+(?:type\s+)?\*/u);
    const discovery = await import("ai-capability-framework/discovery");
    const root = await import("ai-capability-framework") as Record<string, unknown>;
    for (const name of ["createCapabilityDiscovery", "createInMemoryDiscoveryBudget", "CapabilityDiscoverer", "RetrievalCapabilityRouter",
      "ModelCapabilitySelector", "buildCapabilityEmbeddingIndex", "evaluateCapabilityDiscovery", "fingerprintDiscoveryEvaluationSuite"]) {
      expect(discovery).toHaveProperty(name);
      expect(root[name]).toBeUndefined();
    }
    for (const name of ["metadata", "embedding-index", "selection-response", "eval-suite", "eval-observations"]) {
      const key = `./schemas/discovery/${name}.schema.json`;
      expect(metadata.exports[key]).toBe(key);
    }
    expect(metadata.version).toBe("1.0.3");
    expect(metadata.exports["./discovery/*"]).toBeUndefined();
    expect(discovery).not.toHaveProperty("runProviderAttempt");
    expect(discovery).not.toHaveProperty("resolveDiscoveryConfiguration");
  });

  it("keeps all discovery examples portable and free of private built-module imports", async () => {
    for (const file of ["discovery-example", "hybrid-example", "customer-request-example", "customer-harness", "selection-example", "pipeline-example", "evaluation-example"]) {
      const source = await readFile(`examples/12-capability-discovery-selection/${file}.mjs`, "utf8");
      expect(source).not.toContain("../../dist/");
      expect(source).not.toContain("ai-capability-framework/openai/tool-loop");
    }
    expect(await readFile("examples/12-capability-discovery-selection/discovery-example.mjs", "utf8")).toContain('new URL("../support/", import.meta.url)');
  });

  it("documents maturity, current integration and keeps CI freshness ahead of generation", async () => {
    const guide = await readFile("docs/discovery.md", "utf8");
    expect(guide).toContain("release-candidate public API");
    expect(guide).toContain("ordinary model/tool loop");
    expect(guide).toContain("Real embedding quality");
    expect(await readFile("docs/index.md", "utf8")).toContain("discovery.md");
    const ci = await readFile(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain('VITEST_MAX_WORKERS: "2"');
    expect(ci).toContain("npm run eval:discovery:mock");
    expect(ci).not.toContain("run: npm run generate:types");
    expect(ci.indexOf("npm run check:generated")).toBeLessThan(ci.indexOf("npm run build"));
  });
});
