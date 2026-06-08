import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const failures = [];
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const scripts = packageJson.scripts ?? {};

expect(packageJson.private === false, "package.json must remain public.");
expect(packageJson.license === "MIT", "package.json license must remain MIT.");
expect(packageJson.publishConfig?.access === "public", "package.json publishConfig.access must be public.");
expect(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version), "package.json version must be semver-like.");
expect(Boolean(packageJson.repository?.url), "package.json repository URL is required.");
expect(Boolean(packageJson.bugs?.url), "package.json bugs URL is required.");
expect(Boolean(packageJson.homepage), "package.json homepage is required.");

const expectedExactScripts = new Map([
  ["build", "tsc -p tsconfig.json"],
  ["typecheck", "tsc -p tsconfig.json --noEmit"],
  ["lint", "node scripts/check-repo-lint.mjs"],
  ["test", "npm run build --silent && vitest run"],
  ["validate", "npm run build --silent && node dist/cli.js validate examples"],
  ["conformance", "node dist/cli.js conformance run examples --format text"],
  ["gate:examples", "node dist/cli.js gate examples --env production"],
  ["docs:api", "typedoc --options typedoc.json"],
  ["docs:build", "npm run docs:api && npm run check:docs"],
  ["check:package", "npm run build && npm run check:package:contents && npm run check:package-public && npm run check:release-install"],
  ["check:public", "npm run check:package-public && npm run check:workspace-public && npm run check:secrets"]
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
  "npm run gate:examples",
  "npm run docs:build",
  "npm run check:package",
  "npm run check:public",
  "npm run check:runtime",
  "npm run check:optional",
  "npm run check:providers:mock",
  "npm pack --dry-run --json",
  "node scripts/check-certification.mjs"
]);
expect(!scripts["check:certification"].includes("check:providers:live"), "check:certification must not require live provider checks.");
expect(!scripts["check:certification"].includes("test:aws:live"), "check:certification must not require live AWS checks.");

expectFileContains("README.md", ["Final v1.0 certification", "npm run check:certification"]);
expectFileContains("CHANGELOG.md", ["v1.0 certification gate"]);
expectFileContains("docs/index.md", ["v1 certification", "public-framework/v1-certification.md"]);
expectFileContains("docs/api.md", ["check:certification"]);
expectFileContains("docs/release.md", ["npm run check:certification", "fresh-machine quickstart", "no root import of optional dependencies"]);
expectFileContains("docs/public-framework/release-process.md", ["npm run check:certification"]);
expectFileContains("docs/public-framework/v1-certification.md", [
  "npm run check:certification",
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

expectWorkflowContains(".github/workflows/release-dry-run.yml", ["npm run check:certification"]);
expectWorkflowContains(".github/workflows/publish.yml", [
  "tags:",
  "id-token: write",
  "npm run check:certification",
  "npm publish --dry-run",
  "npm publish --access public"
]);

const packFiles = packageDryRunFiles();
for (const required of [
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/public-framework/v1-certification.md",
  "docs/release.md",
  "dist/index.js",
  "dist/runtime/index.js",
  "dist/providers/index.js",
  "schemas/capability-manifest.schema.json",
  "examples/runtime-support-billing/README.md",
  "examples/01-basic-read-capability/README.md"
]) {
  expect(packFiles.includes(required), `Package dry-run missing expected v1 certification file: ${required}`);
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
  for (const snippet of snippets) {
    expect(content.includes(snippet), `${file} must include ${snippet}.`);
  }
}

function expectWorkflowContains(file, snippets) {
  expectFileContains(file, snippets);
}

function packageDryRunFiles() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "cmd.exe" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json"]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "npm pack --dry-run --json"]
      : ["pack", "--dry-run", "--json"];
  const output = execFileSync(command, args, {
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
