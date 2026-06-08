import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const repoRoot = process.cwd();
const failures = [];
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const agentSkillsPackageJson = JSON.parse(readFileSync(path.join(repoRoot, "agent-skills", "package.json"), "utf8"));
const agentSkillsPluginJson = JSON.parse(readFileSync(path.join(repoRoot, "agent-skills", ".codex-plugin", "plugin.json"), "utf8"));
const scripts = packageJson.scripts ?? {};

expect(packageJson.private === false, "package.json must remain public.");
expect(packageJson.license === "MIT", "package.json license must remain MIT.");
expect(packageJson.publishConfig?.access === "public", "package.json publishConfig.access must be public.");
expect(packageJson.engines?.node === ">=20", "package.json engines.node must remain >=20.");
expect(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version), "package.json version must be semver-like.");
expect(Boolean(packageJson.repository?.url), "package.json repository URL is required.");
expect(Boolean(packageJson.bugs?.url), "package.json bugs URL is required.");
expect(Boolean(packageJson.homepage), "package.json homepage is required.");
expect(agentSkillsPackageJson.name === "@aicf/agent-skills", "agent-skills package name must be @aicf/agent-skills.");
expect(agentSkillsPackageJson.version === packageJson.version, "agent-skills package version must match root package version.");
expect(agentSkillsPackageJson.private === false, "agent-skills package must remain public.");
expect(agentSkillsPackageJson.license === packageJson.license, "agent-skills package license must match root package license.");
expect(agentSkillsPackageJson.publishConfig?.access === "public", "agent-skills package publishConfig.access must be public.");
expect(agentSkillsPackageJson.engines?.node === packageJson.engines?.node, "agent-skills package engines.node must match root package engines.node.");
expect(agentSkillsPluginJson.version === agentSkillsPackageJson.version, "agent-skills plugin version must match package version.");
expect(agentSkillsPluginJson.skills === "./skills/", "agent-skills plugin must point at ./skills/.");
expect(Boolean(packageJson.exports?.["./cli"]), "package.json exports must include ./cli.");
expect(packageJson.exports?.["./cli"]?.import === "./dist/cli.js", "package.json ./cli import must point at ./dist/cli.js.");
expect(packageJson.exports?.["./cli"]?.types === "./dist/cli.d.ts", "package.json ./cli types must point at ./dist/cli.d.ts.");
expect(!readFileSync(path.join(repoRoot, "src", "index.ts"), "utf8").includes("runCli"), "Root src/index.ts must not export runCli.");

const expectedExactScripts = new Map([
  ["build", "tsc -p tsconfig.json"],
  ["typecheck", "tsc -p tsconfig.json --noEmit"],
  ["format", "prettier --write ."],
  ["format:check", "prettier --check ."],
  ["lint", "node scripts/check-repo-lint.mjs"],
  ["release:preflight:npm", "node scripts/check-npm-release-preflight.mjs"],
  ["release:publish:dry", "node scripts/check-publish-dry-run.mjs"],
  ["test", "npm run build --silent && vitest run"],
  ["validate", "npm run build --silent && node dist/cli.js validate examples"],
  ["conformance", "node dist/cli.js conformance run examples --format text"],
  ["gate:examples", "node dist/cli.js gate examples --env production"],
  ["docs:api", "typedoc --options typedoc.json"],
  ["docs:build", "npm run docs:api && npm run check:docs"],
  ["check:package", "npm run build && npm run check:package:contents && npm run check:package-public && npm run check:release-install"],
  ["check:metadata", "node scripts/check-metadata.mjs"],
  ["check:licenses", "node scripts/check-licenses.mjs"],
  ["check:final-matrix", "node scripts/check-final-certification-matrix.mjs"],
  ["check:public", "npm run check:package-public && npm run check:workspace-public && npm run check:secrets"],
  ["skills:ci", "npm --prefix agent-skills ci"],
  ["skills:validate", "npm --prefix agent-skills run validate"],
  ["skills:test", "npm --prefix agent-skills run test"],
  ["skills:pack:dry", "npm --prefix agent-skills run pack:dry"],
  ["skills:publish:dry", "npm publish ./agent-skills --dry-run --access public"],
  ["skills:check", "npm --prefix agent-skills run check"]
]);

for (const [name, expected] of expectedExactScripts) {
  expect(scripts[name] === expected, `package script ${name} must be ${JSON.stringify(expected)}.`);
}

expectScriptContains("check", [
  "npm run check:generated",
  "npm run build",
  "npm run typecheck",
  "npm run lint",
  "npm test",
  "npm run validate",
  "npm run conformance",
  "npm run gate:examples",
  "npm run format:check",
  "npm run docs:build",
  "npm run check:package",
  "npm run check:workspace-public"
]);
expectScriptContains("check:certification", [
  "npm run check:generated",
  "npm run build",
  "npm run typecheck",
  "npm run lint",
  "npm test",
  "npm run validate",
  "npm run conformance",
  "npm run format:check",
  "npm run gate:examples",
  "npm run docs:build",
  "npm run check:package",
  "npm run check:public",
  "npm run check:metadata",
  "npm run check:licenses",
  "npm run check:final-matrix",
  "npm run check:runtime",
  "npm run check:optional",
  "npm run check:providers:mock",
  "npm run skills:ci",
  "npm run skills:check",
  "npm run skills:pack:dry",
  "npm pack --dry-run --json",
  "node scripts/check-certification.mjs"
]);
expect(!scripts["check:certification"].includes("check:providers:live"), "check:certification must not require live provider checks.");
expect(!scripts["check:certification"].includes("test:aws:live"), "check:certification must not require live AWS checks.");

expectFileContains("README.md", [
  "# AI Capability Framework (AICF)",
  "Final v1.0 certification",
  "npm run check:certification",
  "docs/public/npm-release-preflight.md",
  "docs/public/license-exceptions.md",
  "docs/public-framework/final-certification-matrix.md",
  "docs/api/public-api-policy.md",
  "docs/getting-started/provider-neutral-quickstart.md",
  "docs/getting-started/anthropic-quickstart.md",
  "docs/getting-started/gemini-quickstart.md",
  "docs/providers/choose-a-runtime.md"
]);
expectFileContains("CHANGELOG.md", ["v1.0 certification gate"]);
expectFileContains("docs/index.md", ["v1 certification", "public-framework/v1-certification.md"]);
expectFileContains("docs/api.md", ["check:certification"]);
expectFileContains("docs/api/public-api-policy.md", [
  "Root API Policy",
  "ai-capability-framework/cli",
  "release-candidate public",
  "runCli",
  "not exported from the root package"
]);
expectFileContains("docs/release.md", [
  "npm run check:certification",
  "npm run check:final-matrix",
  "npm run release:preflight:npm",
  "npm run release:publish:dry",
  "fresh-machine quickstart",
  "no root import of optional dependencies"
]);
expectFileContains("docs/public-framework/release-process.md", [
  "npm run check:certification",
  "npm run check:final-matrix",
  "npm run release:preflight:npm",
  "npm run release:publish:dry",
  "npm release preflight"
]);
expectFileContains("docs/public-framework/v1-certification.md", [
  "npm run check:certification",
  "npm run check:metadata",
  "npm run check:final-matrix",
  "npm run release:preflight:npm",
  "npm run release:publish:dry",
  "Manual Review Checklist",
  "npm package contents",
  "fresh-machine quickstart",
  "no private docs or planning artifacts",
  "no raw provider payloads",
  "no secrets",
  "no hardcoded AWS account IDs or provider keys",
  "no root import of optional dependencies",
  "Live integration tests are opt-in"
]);
expectFileContains("docs/public/npm-release-preflight.md", [
  "ai-capability-framework",
  "@aicf/agent-skills",
  "AICF maintainers",
  "npm owner ls",
  "Trusted Publishing",
  "next",
  "latest",
  "npm run release:preflight:npm",
  "deprecate"
]);
expectFileContains("docs/public-framework/final-certification-matrix.md", [
  "Final Certification Matrix",
  "npm run check:final-matrix",
  "npm run release:publish:dry",
  "Node 20.x, 22.x, and 24.x",
  "Do not zip the working directory manually"
]);
expectFileContains("docs/public/license-exceptions.md", [
  "Dependency License Exceptions",
  "npm run check:licenses",
  "MIT",
  "Apache-2.0",
  "GPL",
  "UNLICENSED",
  "exceptions"
]);
expectFileContains("docs/public-framework/license-decision.md", [
  "AICF uses the MIT license",
  "npm run check:metadata",
  "npm run check:licenses",
  "../public/license-exceptions.md"
]);

expectWorkflowContains(".github/workflows/ci.yml", [
  "matrix:",
  "\"20.x\"",
  "\"22.x\"",
  "\"24.x\"",
  "node-version: ${{ matrix.node }}",
  "npm run format:check",
  "npm --prefix agent-skills ci",
  "npm run skills:check"
]);
expectWorkflowContains(".github/workflows/release-dry-run.yml", [
  "npm run check:certification",
  "npm run archive:source",
  "npm run check:source-archive",
  "npm run release:publish:dry"
]);
expectWorkflowContains(".github/workflows/security.yml", [
  "npm audit --omit=dev --audit-level=high",
  "npm run check:licenses",
  "npm run check:secrets",
  "npm run check:package-public",
  "npm run check:workspace-public"
]);
expectWorkflowContains(".github/workflows/publish.yml", [
  "tags:",
  "id-token: write",
  "AGENT_VERSION=$(node -p \"require('./agent-skills/package.json').version\")",
  "PLUGIN_VERSION=$(node -p \"require('./agent-skills/.codex-plugin/plugin.json').version\")",
  "npm view \"ai-capability-framework@${VERSION}\" version",
  "npm view \"@aicf/agent-skills@${VERSION}\" version",
  "npm run check:certification",
  "npm publish --dry-run",
  "npm publish ./agent-skills --dry-run --access public --tag",
  "npm publish ./agent-skills --access public --tag",
  "npm publish --access public"
]);

const packFiles = packageDryRunFiles();
for (const required of [
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/public-framework/v1-certification.md",
  "docs/public/npm-release-preflight.md",
  "docs/public/license-exceptions.md",
  "docs/public-framework/final-certification-matrix.md",
  "docs/public-framework/license-decision.md",
  "docs/release.md",
  "dist/index.js",
  "dist/cli.js",
  "dist/runtime/index.js",
  "dist/providers/index.js",
  "schemas/capability-manifest.schema.json",
  "examples/runtime-support-billing/README.md",
  "examples/01-basic-read-capability/README.md"
]) {
  expect(packFiles.includes(required), `Package dry-run missing expected v1 certification file: ${required}`);
}

const agentSkillNames = readdirSync(path.join(repoRoot, "agent-skills", "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
expect(agentSkillNames.length === 17, "agent-skills must contain exactly 17 skill directories.");
for (const skillName of agentSkillNames) {
  const skillFile = path.join(repoRoot, "agent-skills", "skills", skillName, "SKILL.md");
  const content = readFileSync(skillFile, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  expect(Boolean(match), `${skillName}: SKILL.md must have YAML frontmatter.`);
  if (!match) continue;
  const frontmatter = parseYaml(match[1]) ?? {};
  expect(frontmatter.metadata?.["aicf.skill.package"] === agentSkillsPackageJson.name, `${skillName}: package metadata must match agent-skills package name.`);
  expect(frontmatter.metadata?.["aicf.skill.version"] === agentSkillsPackageJson.version, `${skillName}: version metadata must match agent-skills package version.`);
}

const agentPackFiles = packageDryRunFiles(path.join(repoRoot, "agent-skills"));
for (const required of [
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "package.json",
  ".codex-plugin/plugin.json",
  "docs/skill-index.md",
  "assets/aicf-agent-skills-icon.svg",
  "assets/aicf-agent-skills-logo.svg",
  "scripts/aicf-skills.mjs",
  "scripts/check-release-readiness.mjs"
]) {
  expect(agentPackFiles.includes(required), `Agent-skills package dry-run missing expected file: ${required}`);
}
for (const skillName of agentSkillNames) {
  expect(agentPackFiles.includes(`skills/${skillName}/SKILL.md`), `Agent-skills package dry-run missing ${skillName}/SKILL.md.`);
}

for (const file of agentPackFiles) {
  const lower = file.toLowerCase();
  const segments = file.split("/");
  if (
    segments.includes("_private")
    || segments.includes(".aicf")
    || segments.includes("generated-docs")
    || segments.includes("dist-source")
    || segments.includes("node_modules")
    || segments.includes("tests")
    || segments.includes("traces")
    || segments.includes("prompts")
    || lower.includes("provider-payload")
    || lower.includes("raw-payload")
    || /\.(tgz|zip|docx|pdf|pptx|xlsx|log)$/i.test(file)
  ) {
    failures.push(`Forbidden agent-skills package file in certification dry-run: ${file}`);
  }
}

for (const file of packFiles) {
  const lower = file.toLowerCase();
  const segments = file.split("/");
  if (
    segments.includes("_private")
    || segments.includes(".aicf")
    || segments.includes("generated-docs")
    || segments.includes("dist-source")
    || segments.includes("node_modules")
    || segments.includes("traces")
    || segments.includes("prompts")
    || lower.includes("provider-payload")
    || lower.includes("raw-payload")
    || /\.(tgz|zip|docx|pdf|pptx|xlsx|log)$/i.test(file)
  ) {
    failures.push(`Forbidden package file in certification dry-run: ${file}`);
  }
}

for (const file of gitFiles(["ls-files"])) {
  const normalized = file.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  if (
    /(^|\/)(_private|\.aicf|generated-docs|dist-source|node_modules|traces?|prompts?)(\/|$)/.test(normalized)
    || lower.includes("provider-payload")
    || lower.includes("raw-payload")
    || /\.(tgz|zip|docx|pdf|pptx|xlsx|log)$/i.test(normalized)
    || lower.includes("credential")
    || lower.includes("api-key")
    || lower.includes("apikey")
    || lower.includes("access-token")
    || lower.includes("access_token")
  ) {
    failures.push(`Forbidden tracked file path for v1 certification: ${normalized}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("AICF v1 certification assertions passed.");
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function expectScriptContains(name, snippets) {
  const script = scripts[name] ?? "";
  expect(Boolean(script), `Missing package script ${name}.`);
  for (const snippet of snippets) {
    expect(script.includes(snippet), `package script ${name} must include ${snippet}.`);
  }
}

function expectFileContains(file, snippets) {
  const fullPath = path.join(repoRoot, file);
  expect(existsSync(fullPath), `Missing required certification file: ${file}`);
  if (!existsSync(fullPath)) return;

  const content = readFileSync(fullPath, "utf8");
  const normalizedContent = content.replace(/\s+/g, " ").trim();
  for (const snippet of snippets) {
    const normalizedSnippet = snippet.replace(/\s+/g, " ").trim();
    expect(content.includes(snippet) || normalizedContent.includes(normalizedSnippet), `${file} must include ${snippet}.`);
  }
}

function expectWorkflowContains(file, snippets) {
  expectFileContains(file, snippets);
}

function packageDryRunFiles(cwd = repoRoot) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "cmd.exe" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json"]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "npm pack --dry-run --json"]
      : ["pack", "--dry-run", "--json"];
  const output = execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output)[0].files.map((file) => file.path.replaceAll("\\", "/")).sort();
}

function gitFiles(args) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return output.split(/\r?\n/).filter(Boolean);
}
