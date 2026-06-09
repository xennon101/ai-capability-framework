import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { runSecretScan } from "../../../scripts/check-secrets.mjs";
import { runNpmReleasePreflight } from "../../../scripts/check-npm-release-preflight.mjs";
import { runLicenseCheck } from "../../../scripts/check-licenses.mjs";
import { runFinalCertificationMatrix } from "../../../scripts/check-final-certification-matrix.mjs";
import { runPublishDryRun } from "../../../scripts/check-publish-dry-run.mjs";
import { runPublicReadabilityCheck } from "../../../scripts/check-public-readability.mjs";
import { runReleaseTagAlignment } from "../../../scripts/check-release-tag-alignment.mjs";

describe("public repository release readiness", () => {
  it("root policy docs contain F16 public repository guidance", () => {
    const security = readFileSync("SECURITY.md", "utf8");
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");
    const governance = readFileSync("GOVERNANCE.md", "utf8");
    const normalizedSecurity = security.replace(/\s+/g, " ");

    expect(security).toContain("## Supported Versions");
    expect(security).toContain("## Response Process");
    expect(security).toContain("## High-Risk Areas");
    expect(normalizedSecurity).toContain("raw prompts, raw traces, provider payloads");

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
      engines: Record<string, string>;
      exports: Record<string, { import: string; types: string }>;
      scripts: Record<string, string>;
    };
    const agentPackageJson = JSON.parse(readFileSync("agent-skills/package.json", "utf8")) as {
      engines: Record<string, string>;
    };

    expect(packageJson.engines.node).toBe(">=20");
    expect(agentPackageJson.engines.node).toBe(packageJson.engines.node);
    expect(packageJson.exports["./cli"]).toEqual({
      import: "./dist/cli.js",
      types: "./dist/cli.d.ts"
    });
    expect(packageJson.scripts.format).toBe("prettier --write .");
    expect(packageJson.scripts["format:check"]).toBe("prettier --check .");
    expect(packageJson.scripts.lint).toBe("node scripts/check-repo-lint.mjs");
    expect(packageJson.scripts["release:preflight:npm"]).toBe("node scripts/check-npm-release-preflight.mjs");
    expect(packageJson.scripts["release:publish:dry"]).toBe("npm run check:release-tag && node scripts/check-publish-dry-run.mjs");
    expect(packageJson.scripts.conformance).toBe("node dist/cli.js conformance run examples --format text");
    expect(packageJson.scripts["gate:examples"]).toBe("node dist/cli.js gate examples --env production");
    expect(packageJson.scripts["check:secrets"]).toBe("node scripts/check-secrets.mjs");
    expect(packageJson.scripts["check:metadata"]).toBe("node scripts/check-metadata.mjs");
    expect(packageJson.scripts["check:licenses"]).toBe("node scripts/check-licenses.mjs");
    expect(packageJson.scripts["check:release-tag"]).toBe("node scripts/check-release-tag-alignment.mjs");
    expect(packageJson.scripts["check:final-matrix"]).toBe("node scripts/check-final-certification-matrix.mjs");
    expect(packageJson.scripts["check:readability"]).toBe("node scripts/check-public-readability.mjs");
    expect(packageJson.scripts["check:package:contents"]).toBe("node scripts/check-package.mjs");
    expect(packageJson.scripts["check:public"]).toBe("npm run check:package-public && npm run check:workspace-public && npm run check:secrets");
    expect(packageJson.scripts["skills:ci"]).toBe("npm --prefix agent-skills ci");
    expect(packageJson.scripts["skills:pack:dry"]).toBe("npm --prefix agent-skills run pack:dry");
    expect(packageJson.scripts["skills:publish:dry"]).toBe("npm publish ./agent-skills --dry-run --access public");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:public");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:metadata");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:licenses");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:release-tag");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:final-matrix");
    expect(packageJson.scripts["check:certification"]).toContain("npm run format:check");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:readability");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:runtime");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:optional");
    expect(packageJson.scripts["check:certification"]).toContain("npm run check:providers:mock");
    expect(packageJson.scripts["check:certification"]).toContain("npm run skills:ci");
    expect(packageJson.scripts["check:certification"]).toContain("npm run skills:check");
    expect(packageJson.scripts["check:certification"]).toContain("npm run skills:pack:dry");
    expect(packageJson.scripts["check:certification"]).toContain("node scripts/check-certification.mjs");
    expect(packageJson.scripts["check:package"]).toContain("npm run check:package:contents");
    expect(packageJson.scripts["check:package"]).toContain("npm run check:package-public");
    expect(packageJson.scripts["check:package"]).toContain("npm run check:release-install");
    expect(packageJson.scripts.check).toContain("npm run lint");
    expect(packageJson.scripts.check).toContain("npm run conformance");
    expect(packageJson.scripts.check).toContain("npm run gate:examples");
    expect(packageJson.scripts.check).toContain("npm run check:readability");
  });

  it("GitHub workflows run the expected public readiness gates", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const dryRun = readFileSync(".github/workflows/release-dry-run.yml", "utf8");
    const security = readFileSync(".github/workflows/security.yml", "utf8");
    const docs = readFileSync(".github/workflows/docs.yml", "utf8");
    const publish = readFileSync(".github/workflows/publish.yml", "utf8");

    expect(ci).toContain("matrix:");
    expect(ci).toContain("\"20.x\"");
    expect(ci).toContain("\"22.x\"");
    expect(ci).toContain("\"24.x\"");
    expect(ci).toContain("node-version: ${{ matrix.node }}");

    for (const command of [
      "npm ci",
      "npm run check:generated",
      "npm run build",
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run validate",
      "npm run conformance",
      "npm run format:check",
      "npm run check:readability",
      "npm run gate:examples",
      "npm run check:package",
      "npm run docs:build",
      "npm --prefix agent-skills ci",
      "npm run skills:check"
    ]) {
      expect(ci).toContain(command);
    }

    expect(dryRun).toContain("npm run check:certification");
    expect(dryRun).toContain("fetch-depth: 0");
    expect(dryRun).toContain("npm run check:release-tag");
    expect(dryRun).toContain("npm run archive:source");
    expect(dryRun).toContain("npm run check:source-archive");
    expect(dryRun).toContain("npm run release:publish:dry");
    expect(security).toContain("npm audit --omit=dev --audit-level=high");
    expect(security).toContain("npm --prefix agent-skills ci");
    expect(security).toContain("npm --prefix agent-skills audit --omit=dev --audit-level=high");
    expect(security).toContain("npm run check:licenses");
    expect(security).toContain("npm run check:secrets");
    expect(security).toContain("npm run check:package-public");
    expect(security).toContain("npm run check:workspace-public");
    expect(docs).toContain("npm run docs:build");
    expect(publish).toContain("tags:");
    expect(publish).toContain("fetch-depth: 0");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("AGENT_VERSION=$(node -p \"require('./agent-skills/package.json').version\")");
    expect(publish).toContain("PLUGIN_VERSION=$(node -p \"require('./agent-skills/.codex-plugin/plugin.json').version\")");
    expect(publish).toContain("npm view \"ai-capability-framework@${VERSION}\" version");
    expect(publish).toContain("npm view \"@aicf/agent-skills@${VERSION}\" version");
    expect(publish).toContain("npm run check:release-tag");
    expect(publish).toContain("npm run check:certification");
    expect(publish).toContain("npm publish --dry-run");
    expect(publish).toContain("npm publish ./agent-skills --dry-run --access public --tag");
    expect(publish).toContain("npm publish ./agent-skills --access public --tag");
    expect(publish).toContain("npm publish --access public");
  });

  it("npm release preflight passes with unpublished versions and first-publish agent-skills warning", () => {
    const report = runNpmReleasePreflight({
      exec: mockNpmExec({
        "whoami": "aicf-maintainer\n",
        "view ai-capability-framework name version dist-tags --json": {
          name: "ai-capability-framework",
          version: "1.0.0-rc.3",
          "dist-tags": { latest: "1.0.0-rc.1", next: "1.0.0-rc.3" }
        },
        "view ai-capability-framework@1.0.0 version --json": npm404(),
        "owner ls ai-capability-framework": "aicf-maintainer <maintainer@example.com>\n",
        "view @aicf/agent-skills name version dist-tags --json": npm404(),
        "view @aicf/agent-skills@1.0.0 version --json": npm404()
      })
    });

    expect(report.ok).toBe(true);
    expect(report.expectedDistTag).toBe("latest");
    expect(report.warnings.join("\n")).toContain("@aicf/agent-skills is not published yet");
  });

  it("npm release preflight fails for already-published target versions and strict first-publish gaps", () => {
    const alreadyPublished = runNpmReleasePreflight({
      exec: mockNpmExec({
        "whoami": "aicf-maintainer\n",
        "view ai-capability-framework name version dist-tags --json": {
          name: "ai-capability-framework",
          version: "1.0.0",
          "dist-tags": { next: "1.0.0" }
        },
        "view ai-capability-framework@1.0.0 version --json": "\"1.0.0\"",
        "owner ls ai-capability-framework": "aicf-maintainer <maintainer@example.com>\n",
        "view @aicf/agent-skills name version dist-tags --json": npm404(),
        "view @aicf/agent-skills@1.0.0 version --json": npm404()
      })
    });

    expect(alreadyPublished.ok).toBe(false);
    expect(alreadyPublished.failures.join("\n")).toContain("ai-capability-framework@1.0.0 is already published");

    const strictFirstPublish = runNpmReleasePreflight({
      strict: true,
      exec: mockNpmExec({
        "whoami": "aicf-maintainer\n",
        "view ai-capability-framework name version dist-tags --json": {
          name: "ai-capability-framework",
          version: "1.0.0-rc.3",
          "dist-tags": { latest: "1.0.0-rc.1", next: "1.0.0-rc.3" }
        },
        "view ai-capability-framework@1.0.0 version --json": npm404(),
        "owner ls ai-capability-framework": "aicf-maintainer <maintainer@example.com>\n",
        "view @aicf/agent-skills name version dist-tags --json": npm404(),
        "view @aicf/agent-skills@1.0.0 version --json": npm404()
      })
    });

    expect(strictFirstPublish.ok).toBe(false);
    expect(strictFirstPublish.failures.join("\n")).toContain("@aicf/agent-skills is not published yet");
  });

  it("npm release preflight fails on package metadata mismatches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicf-npm-preflight-"));
    await mkdir(path.join(root, "agent-skills"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "wrong-name", version: "1.0.0", private: false, publishConfig: { access: "public" } })
    );
    await writeFile(
      path.join(root, "agent-skills", "package.json"),
      JSON.stringify({ name: "@aicf/agent-skills", version: "1.0.0-rc.4", private: false, publishConfig: { access: "public" } })
    );

    const report = runNpmReleasePreflight({ root, exec: mockNpmExec({ whoami: npm404() }) });

    expect(report.ok).toBe(false);
    expect(report.failures).toContain("package.json must use package name ai-capability-framework.");
    expect(report.failures).toContain("Root and agent-skills package versions must match before release.");
  });

  it("release tag alignment guard handles version and tag states safely", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicf-release-tag-"));
    await mkdir(path.join(root, "agent-skills", ".codex-plugin"), { recursive: true });
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writePackageSet(root, "1.0.0", { includePlugin: true });

    const noTag = runReleaseTagAlignment({
      root,
      exec: mockGitExec({
        "rev-parse --git-dir": ".git\n",
        "rev-parse HEAD": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
        "rev-list -n 1 refs/tags/v1.0.0": gitError("unknown revision")
      })
    });
    expect(noTag.ok).toBe(true);
    expect(noTag.tagSha).toBeUndefined();

    const tagAtHead = runReleaseTagAlignment({
      root,
      exec: mockGitExec({
        "rev-parse --git-dir": ".git\n",
        "rev-parse HEAD": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
        "rev-list -n 1 refs/tags/v1.0.0": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
      })
    });
    expect(tagAtHead.ok).toBe(true);

    const tagElsewhere = runReleaseTagAlignment({
      root,
      exec: mockGitExec({
        "rev-parse --git-dir": ".git\n",
        "rev-parse HEAD": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
        "rev-list -n 1 refs/tags/v1.0.0": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
      })
    });
    expect(tagElsewhere.ok).toBe(false);
    expect(tagElsewhere.failures.join("\n")).toContain("Version 1.0.0 is already tagged at bbbbbbb, but HEAD is aaaaaaa");
  });

  it("release tag alignment guard fails version mismatches and handles source archives without git", async () => {
    const mismatchRoot = await mkdtemp(path.join(tmpdir(), "aicf-release-tag-mismatch-"));
    await mkdir(path.join(mismatchRoot, "agent-skills", ".codex-plugin"), { recursive: true });
    await writePackageSet(mismatchRoot, "1.0.0", { agentVersion: "1.0.1", includePlugin: true });

    const mismatch = runReleaseTagAlignment({ root: mismatchRoot, exec: mockGitExec({}) });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.failures.join("\n")).toContain("agent-skills package version 1.0.1 does not match root package version 1.0.0");

    const sourceArchiveRoot = await mkdtemp(path.join(tmpdir(), "aicf-release-tag-no-git-"));
    await mkdir(path.join(sourceArchiveRoot, "agent-skills", ".codex-plugin"), { recursive: true });
    await writePackageSet(sourceArchiveRoot, "1.0.0", { includePlugin: true });

    const noGit = runReleaseTagAlignment({ root: sourceArchiveRoot, exec: mockGitExec({}) });
    expect(noGit.ok).toBe(true);
    expect(noGit.warnings.join("\n")).toContain("Git metadata is unavailable");

    const strictNoGit = runReleaseTagAlignment({ root: sourceArchiveRoot, requireGit: true, exec: mockGitExec({}) });
    expect(strictNoGit.ok).toBe(false);
    expect(strictNoGit.failures.join("\n")).toContain("Git metadata is unavailable");
  });

  it("publish dry-run wrapper computes dist tags and runs both package dry-runs", async () => {
    const prereleaseRoot = await mkdtemp(path.join(tmpdir(), "aicf-publish-dry-run-prerelease-"));
    await mkdir(path.join(prereleaseRoot, "agent-skills"), { recursive: true });
    await writePackageSet(prereleaseRoot, "1.0.0-rc.6");
    const prereleaseCommands: string[] = [];
    const prerelease = runPublishDryRun({
      root: prereleaseRoot,
      exec: (_command, args) => {
        prereleaseCommands.push(args.join(" "));
        return "dry run ok";
      }
    });

    expect(prerelease.ok).toBe(true);
    expect(prerelease.distTag).toBe("next");
    expect(prereleaseCommands).toEqual([
      "publish --dry-run --access public --tag next",
      "publish ./agent-skills --dry-run --access public --tag next"
    ]);

    const root = await mkdtemp(path.join(tmpdir(), "aicf-publish-dry-run-"));
    await mkdir(path.join(root, "agent-skills"), { recursive: true });
    await writePackageSet(root, "1.0.0");
    const stableCommands: string[] = [];
    const stable = runPublishDryRun({
      root,
      exec: (_command, args) => {
        stableCommands.push(args.join(" "));
        return "dry run ok";
      }
    });

    expect(stable.ok).toBe(true);
    expect(stable.distTag).toBe("latest");
    expect(stableCommands).toEqual([
      "publish --dry-run --access public --tag latest",
      "publish ./agent-skills --dry-run --access public --tag latest"
    ]);
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
    const normalizedCertification = certification.replace(/\s+/g, " ");
    const licenseDecision = readFileSync("docs/public-framework/license-decision.md", "utf8");
    const npmPreflight = readFileSync("docs/public/npm-release-preflight.md", "utf8");
    const apiPolicy = readFileSync("docs/api/public-api-policy.md", "utf8");

    expect(release).toContain("npm publish --dry-run");
    expect(release).toContain("Node 20.x, 22.x, and 24.x");
    expect(release).toContain("engines.node >=20");
    expect(release).toContain("npm run check:certification");
    expect(release).toContain("npm run check:metadata");
    expect(release).toContain("npm run check:release-tag");
    expect(release).toContain("npm run release:preflight:npm");
    expect(release).toContain("npm run check:final-matrix");
    expect(release).toContain("npm run release:publish:dry");
    expect(release).toContain("npm run check:licenses");
    expect(release).toContain("npm provenance and trusted publishing");
    expect(release).toContain("Partial publish recovery");
    expect(release).toContain("GitHub repository metadata");
    expect(release).toContain("Do not zip the workspace directory");
    expect(process).toContain("semantic versioning");
    expect(process).toContain("npm run check:certification");
    expect(process).toContain("npm run release:preflight:npm");
    expect(process).toContain("npm run check:final-matrix");
    expect(process).toContain("npm run release:publish:dry");
    expect(process).toContain("npm run check:licenses");
    expect(process).toContain("npm run check:release-tag");
    expect(process).toContain("trusted publishing");
    expect(compatibility).toContain("Breaking changes include");
    expect(compatibility).toContain("Minor changes include");
    expect(compatibility).toContain("Patch changes include");
    expect(deprecation.replace(/\s+/g, " ")).toContain("at least one minor release");
    expect(certification).toContain("npm run check:certification");
    expect(certification).toContain("npm run check:metadata");
    expect(certification).toContain("npm run check:final-matrix");
    expect(certification).toContain("npm run check:licenses");
    expect(certification).toContain("npm run check:release-tag");
    expect(certification).toContain("Public API Policy");
    expect(certification).toContain("Node 20.x, 22.x, and 24.x");
    expect(certification).toContain("npm run release:preflight:npm");
    expect(certification).toContain("Manual Review Checklist");
    expect(normalizedCertification).toContain(
      "GitHub repository About/description says AICF is a provider-agnostic governed AI capability framework"
    );
    expect(normalizedCertification).toContain(
      "GitHub topics include at least: ai, agents, tool-calling, evals, governance, model-context-protocol, langchain, gemini, anthropic, openai, typescript"
    );
    expect(certification).toContain("Live integration tests are opt-in");
    expect(licenseDecision).toContain("AICF uses the MIT license");
    expect(licenseDecision).toContain("npm run check:metadata");
    expect(licenseDecision).toContain("npm run check:licenses");
    expect(licenseDecision).toContain("../public/license-exceptions.md");
    expect(readFileSync("docs/public/license-exceptions.md", "utf8")).toContain("Dependency License Exceptions");
    expect(npmPreflight).toContain("AICF maintainers");
    expect(npmPreflight).toContain("npm owner ls");
    expect(npmPreflight).toContain("Trusted Publishing");
    expect(npmPreflight).toContain("npm run check:final-matrix");
    expect(npmPreflight).toContain("npm run check:release-tag");
    expect(npmPreflight).toContain("npm run release:publish:dry");
    expect(npmPreflight).toContain("next");
    expect(npmPreflight).toContain("latest");
    expect(apiPolicy).toContain("ai-capability-framework/cli");
    expect(apiPolicy).toContain("not exported from the root package");
    const finalMatrix = readFileSync("docs/public-framework/final-certification-matrix.md", "utf8");
    const normalizedFinalMatrix = finalMatrix.replace(/\s+/g, " ");
    expect(finalMatrix).toContain("Final Certification Matrix");
    expect(finalMatrix).toContain("npm run check:release-tag");
    expect(normalizedFinalMatrix).toContain(
      "GitHub repository About/description says AICF is a provider-agnostic governed AI capability framework"
    );
    expect(normalizedFinalMatrix).toContain(
      "GitHub topics include at least: ai, agents, tool-calling, evals, governance, model-context-protocol, langchain, gemini, anthropic, openai, typescript"
    );
  });

  it("public readability checker passes on the current repository", () => {
    expect(runPublicReadabilityCheck()).toEqual([]);
  });

  it("public readability checker rejects collapsed docs and config fixtures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aicf-readability-"));
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(root, "agent-skills", ".codex-plugin"), { recursive: true });

    await writeFile(
      path.join(root, "README.md"),
      "# Title This body sentence is collapsed onto the heading line and should be rejected by the public readability guard.\n"
    );
    await writeFile(path.join(root, "CHANGELOG.md"), "```bash npm test ```\n");
    await writeFile(path.join(root, "CONTRIBUTING.md"), `${Array.from({ length: 6 }, () => "x".repeat(241)).join("\n")}\n`);
    await writeFile(path.join(root, "GOVERNANCE.md"), "Before | A | B | | --- | --- | | X | Y | after\n");
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\n");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "collapsed" }));
    await writeFile(path.join(root, "agent-skills", "package.json"), JSON.stringify({ name: "collapsed" }));
    await writeFile(path.join(root, "agent-skills", ".codex-plugin", "plugin.json"), JSON.stringify({ name: "collapsed" }));

    const failures = runPublicReadabilityCheck(root).join("\n");

    expect(failures).toContain("collapsed heading/body line");
    expect(failures).toContain("fenced code block on one line");
    expect(failures).toContain("non-table line(s) over 240 characters");
    expect(failures).toContain("collapsed Markdown table");
    expect(failures).toContain("Workflow YAML");
    expect(failures).toContain("Public JSON");
  });

  it("final certification assertions pass against the current public repository", () => {
    const output = execFileSync(process.execPath, ["scripts/check-certification.mjs"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    expect(output).toContain("AICF v1 certification assertions passed.");
  });

  it("metadata assertions pass against the current public repository", () => {
    const output = execFileSync(process.execPath, ["scripts/check-metadata.mjs"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    expect(output).toContain("AICF metadata consistency checks passed.");
  });

  it("dependency license assertions pass against the current public repository", () => {
    const report = runLicenseCheck();

    expect(report.ok).toBe(true);
    expect(report.checkedPackageCount).toBeGreaterThan(0);
    expect(report.failures).toEqual([]);
  });

  it("final certification matrix assertions pass against the current public repository", () => {
    const report = runFinalCertificationMatrix();

    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
  });
});

function mockNpmExec(responses: Record<string, unknown>) {
  return (_command: string, args: string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) {
      throw response;
    }
    if (response === undefined) {
      throw Object.assign(new Error(`unexpected npm command: ${key}`), {
        status: 1,
        stdout: "",
        stderr: `unexpected npm command: ${key}`
      });
    }
    return typeof response === "string" ? response : JSON.stringify(response);
  };
}

function mockGitExec(responses: Record<string, unknown>) {
  return (_command: string, args: string[]) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response instanceof Error) {
      throw response;
    }
    if (response === undefined) {
      throw gitError(`unexpected git command: ${key}`);
    }
    return String(response);
  };
}

function gitError(message: string) {
  return Object.assign(new Error(message), {
    status: 1,
    stdout: "",
    stderr: message
  });
}

async function writePackageSet(
  root: string,
  version: string,
  options: { agentVersion?: string; includePlugin?: boolean } = {}
) {
  const agentVersion = options.agentVersion ?? version;
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "ai-capability-framework", version, private: false, publishConfig: { access: "public" } })
  );
  await writeFile(
    path.join(root, "agent-skills", "package.json"),
    JSON.stringify({ name: "@aicf/agent-skills", version: agentVersion, private: false, publishConfig: { access: "public" } })
  );
  if (options.includePlugin) {
    await writeFile(path.join(root, "agent-skills", ".codex-plugin", "plugin.json"), JSON.stringify({ version }));
  }
}

function npm404() {
  return Object.assign(new Error("npm 404"), {
    status: 1,
    stdout: "",
    stderr: "npm error code E404\nnpm error 404 Not Found"
  });
}
