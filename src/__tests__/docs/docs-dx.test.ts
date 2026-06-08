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
    expect(docsCheck.numberedExamples).toHaveLength(11);
    expect(docsCheck.runDocsCheck()).toEqual([]);
  });

  it("README contains the required F15 positioning statements and docs path", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("AICF is not an agent framework. It is a governed capability layer for AI-accessible application functionality.");
    expect(readme).toContain("Models propose; applications validate, authorize, execute, and audit.");
    expect(readme).toContain("docs/getting-started/installation.md");
    expect(readme).toContain("docs/getting-started/quickstart.md");
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
    expect(files).toContain("CODE_OF_CONDUCT.md");
    expect(files).toContain("GOVERNANCE.md");
    expect(files).toContain("ROADMAP.md");
    expect(files).toContain("docs/index.md");
    expect(files).toContain("examples/01-basic-read-capability/README.md");
    expect(files.some((file) => file.startsWith("generated-docs/"))).toBe(false);
  });
});
