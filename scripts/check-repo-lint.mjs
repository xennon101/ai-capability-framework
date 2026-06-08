import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const failures = [];
const repoRoot = process.cwd();

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const scripts = packageJson.scripts ?? {};

expect(packageJson.private === false, "package.json must keep private set to false.");
expect(packageJson.publishConfig?.access === "public", "package.json must publish with public access.");
expect(packageJson.license === "MIT", "package.json license must remain MIT.");

for (const [name, expected] of [
  ["lint", "node scripts/check-repo-lint.mjs"],
  ["conformance", "node dist/cli.js conformance run examples --format text"],
  ["gate:examples", "node dist/cli.js gate examples --env production"],
  ["check:secrets", "node scripts/check-secrets.mjs"],
  ["check:package:contents", "node scripts/check-package.mjs"],
  ["check:public", "npm run check:package-public && npm run check:workspace-public && npm run check:secrets"]
]) {
  expect(scripts[name] === expected, `package script ${name} must be ${JSON.stringify(expected)}.`);
}

expect(scripts["check:certification"]?.includes("node scripts/check-certification.mjs"), "package script check:certification must run scripts/check-certification.mjs.");

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
]);
expectWorkflowContains(".github/workflows/release-dry-run.yml", [
  "npm run check:certification",
  "npm run archive:source",
  "npm run check:source-archive",
  "npm publish --dry-run"
]);
expectWorkflowContains(".github/workflows/security.yml", [
  "npm audit",
  "npm run check:secrets",
  "npm run check:package-public",
  "npm run check:workspace-public"
]);
expectWorkflowContains(".github/workflows/docs.yml", [
  "npm run docs:build"
]);
expectWorkflowContains(".github/workflows/publish.yml", [
  "id-token: write",
  "npm run check:certification",
  "npm publish --dry-run",
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
