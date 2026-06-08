import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("public docs and developer experience", () => {
  it("passes the repository docs/DX checker", async () => {
    const docsCheck = await import("../../../scripts/check-docs.mjs") as {
      runDocsCheck: () => string[];
      numberedExamples: string[];
      requiredDocs: string[];
      requiredRootDocs: string[];
    };

    expect(docsCheck.requiredRootDocs).toContain("CODE_OF_CONDUCT.md");
    expect(docsCheck.requiredRootDocs).toContain("GOVERNANCE.md");
    expect(docsCheck.requiredRootDocs).toContain("ROADMAP.md");
    expect(docsCheck.requiredDocs).toContain("docs/index.md");
    expect(docsCheck.requiredDocs).toContain("docs/api/public-api-policy.md");
    expect(docsCheck.requiredDocs).toContain("docs/public-framework/final-certification-matrix.md");
    expect(docsCheck.requiredDocs).toContain("docs/public/npm-release-preflight.md");
    expect(docsCheck.requiredDocs).toContain("docs/public/license-exceptions.md");
    expect(docsCheck.numberedExamples).toHaveLength(11);
    expect(docsCheck.runDocsCheck()).toEqual([]);
  });

  it("README contains the required F15 positioning statements and docs path", () => {
    const readme = readFileSync("README.md", "utf8");
    const normalizedReadme = readme.replace(/\s+/g, " ").trim();

    expect(normalizedReadme).toContain("AICF is not an agent framework. It is a governed capability layer for AI-accessible application functionality.");
    expect(normalizedReadme).toContain("Models propose; applications validate, authorize, execute, and audit.");
    expect(readme).toContain("docs/getting-started/installation.md");
    expect(readme).toContain("docs/getting-started/provider-neutral-quickstart.md");
    expect(readme).toContain("docs/getting-started/quickstart.md");
    expect(readme).toContain("docs/getting-started/anthropic-quickstart.md");
    expect(readme).toContain("docs/getting-started/gemini-quickstart.md");
    expect(readme).toContain("docs/providers/choose-a-runtime.md");
    expect(readme).toContain("docs/api/public-api-policy.md");
    expect(readme).toContain("docs/public-framework/final-certification-matrix.md");
    expect(readme).toContain("docs/public/license-exceptions.md");
    expect(readme).toContain("docs/index.md");
  });

  it("package exposes docs scripts and generated TypeDoc stays out of package dry-run", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const npmExecPath = process.env.npm_execpath;
    const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
    const args = npmExecPath ? [npmExecPath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const files = JSON.parse(output)[0].files.map((file: { path: string }) => file.path.replaceAll("\\", "/")) as string[];

    expect(packageJson.scripts["docs:api"]).toBe("typedoc --options typedoc.json");
    expect(packageJson.scripts["docs:build"]).toContain("npm run docs:api");
    expect(packageJson.scripts["check:docs"]).toBe("node scripts/check-docs.mjs");
    expect(packageJson.scripts.format).toBe("prettier --write .");
    expect(packageJson.scripts["format:check"]).toBe("prettier --check .");
    expect(files).toContain("CODE_OF_CONDUCT.md");
    expect(files).toContain("GOVERNANCE.md");
    expect(files).toContain("ROADMAP.md");
    expect(files).toContain("docs/index.md");
    expect(files).toContain("docs/api/public-api-policy.md");
    expect(files).toContain("docs/public-framework/final-certification-matrix.md");
    expect(files).toContain("docs/public/npm-release-preflight.md");
    expect(files).toContain("docs/public/license-exceptions.md");
    expect(files).toContain("docs/getting-started/provider-neutral-quickstart.md");
    expect(files).toContain("docs/getting-started/anthropic-quickstart.md");
    expect(files).toContain("docs/getting-started/gemini-quickstart.md");
    expect(files).toContain("docs/providers/choose-a-runtime.md");
    expect(files).toContain("examples/01-basic-read-capability/README.md");
    expect(files.some((file) => file.startsWith("generated-docs/"))).toBe(false);
  });
});
