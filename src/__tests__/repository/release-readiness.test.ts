import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runSecretScan } from "../../../scripts/check-secrets.mjs";

describe("public repository release readiness", () => {
  it("root policy docs contain F16 public repository guidance", () => {
    const security = readFileSync("SECURITY.md", "utf8");
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");
    const governance = readFileSync("GOVERNANCE.md", "utf8");

    expect(security).toContain("## Supported Versions");
    expect(security).toContain("## Response Process");
    expect(security).toContain("## High-Risk Areas");
    expect(security).toContain("raw prompts, raw traces, provider payloads");

    expect(contributing).toContain("## Optional Live Integration Tests");
    expect(contributing).toContain("## Changelog And Release Notes");
    expect(contributing).toContain("## Provider Adapters");
    expect(contributing).toContain("## Security Packs");
    expect(contributing).toContain("## Manifest Fields");

    expect(governance).toContain("## Maintainer Roles");
    expect(governance).toContain("## Decision Process");
    expect(governance).toContain("## Release Approval");
    expect(governance).toContain("## Deprecation Process");
  });

  it("package scripts expose the public release gates", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.lint).toBe("node scripts/check-repo-lint.mjs");
    expect(packageJson.scripts.conformance).toBe("node dist/cli.js conformance run examples --format text");
    expect(packageJson.scripts["gate:examples"]).toBe("node dist/cli.js gate examples --env production");
    expect(packageJson.scripts["check:secrets"]).toBe("node scripts/check-secrets.mjs");
    expect(packageJson.scripts["check:package:contents"]).toBe("node scripts/check-package.mjs");
    expect(packageJson.scripts["check:public"]).toBe("npm run check:package-public && npm run check:workspace-public && npm run check:secrets");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:public");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:runtime");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:optional");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:providers:mock");
    expect(packageJson.scripts["check:certification"]).toContain("node scripts/check-certification.mjs");
    expect(packageJson.scripts["check:package"]).toContain("npm run check:package:contents");
    expect(packageJson.scripts["check:package"]).toContain("npm run check:package-public");
    expect(packageJson.scripts["check:package"]).toContain("npm run check:release-install");
    expect(packageJson.scripts.check).toContain("npm run lint");
    expect(packageJson.scripts.check).toContain("npm run conformance");
    expect(packageJson.scripts.check).toContain("npm run gate:examples");
  });

  it("GitHub workflows run the expected public readiness gates", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const dryRun = readFileSync(".github/workflows/release-dry-run.yml", "utf8");
    const security = readFileSync(".github/workflows/security.yml", "utf8");
    const docs = readFileSync(".github/workflows/docs.yml", "utf8");
    const publish = readFileSync(".github/workflows/publish.yml", "utf8");

    for (const command of [
      "npm ci",
      "npm run check:generated",
      "npm run build",
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run validate",
      "npm run conformance",
      "npm run gate:examples",
      "npm run check:package",
      "npm run docs:build"
    ]) {
      expect(ci).toContain(command);
    }

    expect(dryRun).toContain("npm run check:certification");
    expect(dryRun).toContain("npm run archive:source");
    expect(dryRun).toContain("npm run check:source-archive");
    expect(dryRun).toContain("npm publish --dry-run");
    expect(security).toContain("npm audit --omit=dev --audit-level=high");
    expect(security).toContain("npm run check:secrets");
    expect(security).toContain("npm run check:package-public");
    expect(security).toContain("npm run check:workspace-public");
    expect(docs).toContain("npm run docs:build");
    expect(publish).toContain("tags:");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("npm run check:certification");
    expect(publish).toContain("npm publish --dry-run");
    expect(publish).toContain("npm publish --access public");
  });

  it("secret scanner catches high-confidence credentials and allows synthetic examples", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicf-secret-scan-"));
    await writeFile(path.join(root, "unsafe.md"), "leaked key: AKIA1234567890ABCDEF\n");
    await writeFile(path.join(root, "safe.md"), "synthetic example token: ghp_000000000000000000000000000000000000\n");

    const failures = runSecretScan(["unsafe.md", "safe.md"], { root });

    expect(failures).toEqual(["AWS access key candidate in unsafe.md:1"]);
  });

  it("release docs explain semver, source review, dry-run publish, and no manual zips", () => {
    const release = readFileSync("docs/release.md", "utf8");
    const process = readFileSync("docs/public-framework/release-process.md", "utf8");
    const compatibility = readFileSync("docs/public-framework/compatibility-policy.md", "utf8");
    const deprecation = readFileSync("docs/public-framework/deprecation-policy.md", "utf8");
    const certification = readFileSync("docs/public-framework/v1-certification.md", "utf8");

    expect(release).toContain("npm publish --dry-run");
    expect(release).toContain("npm run check:certification");
    expect(release).toContain("Do not zip the workspace directory");
    expect(process).toContain("semantic versioning");
    expect(process).toContain("npm run check:certification");
    expect(process).toContain("trusted publishing");
    expect(compatibility).toContain("Breaking changes include");
    expect(compatibility).toContain("Minor changes include");
    expect(compatibility).toContain("Patch changes include");
    expect(deprecation).toContain("at least one minor release");
    expect(certification).toContain("npm run check:certification");
    expect(certification).toContain("Manual Review Checklist");
    expect(certification).toContain("Live integration tests are opt-in");
  });

  it("final certification assertions pass against the current public repository", () => {
    const output = execFileSync(process.execPath, ["scripts/check-certification.mjs"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    expect(output).toContain("AICF v1 certification assertions passed.");
  });
});
