import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const failures = [];
const repoRoot = process.cwd();

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const agentSkillsPackageJson = JSON.parse(readFileSync(path.join(repoRoot, "agent-skills", "package.json"), "utf8"));
const scripts = packageJson.scripts ?? {};

expect(packageJson.private === false, "package.json must keep private set to false.");
expect(packageJson.publishConfig?.access === "public", "package.json must publish with public access.");
expect(packageJson.license === "MIT", "package.json license must remain MIT.");
expect(packageJson.engines?.node === ">=20", "package.json engines.node must remain >=20.");
expect(agentSkillsPackageJson.engines?.node === packageJson.engines?.node, "agent-skills engines.node must match root package engines.node.");

for (const [name, expected] of [
  ["format", "prettier --write ."],
  ["format:check", "prettier --check ."],
  ["lint", "node scripts/check-repo-lint.mjs"],
  ["release:preflight:npm", "node scripts/check-npm-release-preflight.mjs"],
  ["release:publish:dry", "npm run check:release-tag && node scripts/check-publish-dry-run.mjs"],
  ["conformance", "node dist/cli.js conformance run examples --format text"],
  ["gate:examples", "node dist/cli.js gate examples --env production"],
  ["check:secrets", "node scripts/check-secrets.mjs"],
  ["check:metadata", "node scripts/check-metadata.mjs"],
  ["check:licenses", "node scripts/check-licenses.mjs"],
  ["check:release-tag", "node scripts/check-release-tag-alignment.mjs"],
  ["check:final-matrix", "node scripts/check-final-certification-matrix.mjs"],
  ["check:readability", "node scripts/check-public-readability.mjs"],
  ["check:package:contents", "node scripts/check-package.mjs"],
  ["check:public", "npm run check:package-public && npm run check:workspace-public && npm run check:secrets"],
  ["skills:ci", "npm --prefix agent-skills ci"],
  ["skills:pack:dry", "npm --prefix agent-skills run pack:dry"],
  ["skills:publish:dry", "npm publish ./agent-skills --dry-run --access public"]
]) {
  expect(scripts[name] === expected, `package script ${name} must be ${JSON.stringify(expected)}.`);
}

expect(scripts["check:certification"]?.includes("node scripts/check-certification.mjs"), "package script check:certification must run scripts/check-certification.mjs.");
expect(scripts["check:certification"]?.includes("npm run skills:ci"), "package script check:certification must install agent-skills with npm ci.");
expect(scripts["check:certification"]?.includes("npm run skills:check"), "package script check:certification must run agent-skills checks.");
expect(scripts["check:certification"]?.includes("npm run skills:pack:dry"), "package script check:certification must dry-run pack agent-skills.");
expect(scripts["check:certification"]?.includes("npm run check:metadata"), "package script check:certification must run metadata checks.");
expect(scripts["check:certification"]?.includes("npm run check:licenses"), "package script check:certification must run dependency license checks.");
expect(scripts["check:certification"]?.includes("npm run check:release-tag"), "package script check:certification must run release tag alignment checks.");
expect(scripts["check:certification"]?.includes("npm run check:final-matrix"), "package script check:certification must run final certification matrix checks.");
expect(scripts["check:certification"]?.includes("npm run format:check"), "package script check:certification must run format checks.");
expect(scripts["check:certification"]?.includes("npm run check:readability"), "package script check:certification must run readability checks.");

for (const workflow of [
  ".github/workflows/ci.yml",
  ".github/workflows/release-dry-run.yml",
  ".github/workflows/security.yml",
  ".github/workflows/docs.yml",
  ".github/workflows/publish.yml"
]) {
  expect(existsSync(path.join(repoRoot, workflow)), `Missing workflow file: ${workflow}`);
}

expectWorkflowContains(".github/workflows/ci.yml", [
  "matrix:",
  "\"20.x\"",
  "\"22.x\"",
  "\"24.x\"",
  "node-version: ${{ matrix.node }}",
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
]);
expectWorkflowContains(".github/workflows/release-dry-run.yml", [
  "fetch-depth: 0",
  "npm run check:certification",
  "npm run archive:source",
  "npm run check:source-archive",
  "npm run check:release-tag",
  "npm run release:publish:dry"
]);
expectWorkflowContains(".github/workflows/security.yml", [
  "npm --prefix agent-skills ci",
  "npm audit",
  "npm --prefix agent-skills audit --omit=dev --audit-level=high",
  "npm run check:licenses",
  "npm run check:secrets",
  "npm run check:package-public",
  "npm run check:workspace-public"
]);
expectWorkflowContains(".github/workflows/docs.yml", [
  "npm run docs:build"
]);
expectWorkflowContains(".github/workflows/publish.yml", [
  "fetch-depth: 0",
  "id-token: write",
  "AGENT_VERSION=$(node -p \"require('./agent-skills/package.json').version\")",
  "PLUGIN_VERSION=$(node -p \"require('./agent-skills/.codex-plugin/plugin.json').version\")",
  "npm view \"ai-capability-framework@${VERSION}\" version",
  "npm view \"@aicf/agent-skills@${VERSION}\" version",
  "npm run check:release-tag",
  "npm run check:certification",
  "npm publish --dry-run",
  "npm publish ./agent-skills --dry-run --access public --tag",
  "npm publish ./agent-skills --access public --tag",
  "npm publish --access public"
]);

for (const file of [...gitFiles(["ls-files"]), ...gitFiles(["ls-files", "--others", "--exclude-standard"])]) {
  const normalized = file.replaceAll("\\", "/");
  if (!/\.(ts|js|mjs)$/.test(normalized)) {
    continue;
  }

  if (normalized.startsWith("dist/") || normalized.startsWith("generated-docs/")) {
    continue;
  }

  const content = readFileSync(path.join(repoRoot, file), "utf8");
  if (/capability,\s*\r?\n\s*capability[,}]/.test(content)) {
    failures.push(`Duplicate shorthand object key pattern found in ${normalized}: capability`);
  }
  if (/"SK:"\s*:\s*[^,\n]+,\s*\r?\n\s*"SK:"\s*:/.test(content)) {
    failures.push(`Duplicate object key pattern found in ${normalized}: "SK:"`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Repository lint passed.");
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function expectWorkflowContains(file, snippets) {
  const content = readFileSync(path.join(repoRoot, file), "utf8");
  for (const snippet of snippets) {
    expect(content.includes(snippet), `${file} must include ${snippet}.`);
  }
}

function gitFiles(args) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return output.split(/\r?\n/).filter(Boolean);
}
