import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const forbiddenPackageSegments = new Set([
  ".git",
  ".aicf",
  "_private",
  "coverage",
  "dist-source",
  "generated-docs",
  "local",
  "logs",
  "node_modules",
  "private",
  "prompts",
  "traces"
]);

const forbiddenPackageExtensions = /\.(?:bak|backup|docx|log|pdf|pptx|tmp|tgz|xlsx|zip)$/iu;

export function runFinalCertificationMatrix(options = {}) {
  const root = options.root ? path.resolve(options.root) : repoRoot;
  const failures = [];
  const packageJson = readJson(path.join(root, "package.json"), failures, "package.json");
  const agentPackageJson = readJson(path.join(root, "agent-skills", "package.json"), failures, "agent-skills/package.json");
  if (!packageJson || !agentPackageJson) {
    return { ok: false, failures };
  }

  const scripts = packageJson.scripts ?? {};
  const expectedScripts = new Map([
    ["build", "tsc -p tsconfig.json"],
    ["typecheck", "tsc -p tsconfig.json --noEmit"],
    ["test", "npm run build --silent && vitest run"],
    ["validate", "npm run build --silent && node dist/cli.js validate examples"],
    ["conformance", "node dist/cli.js conformance run examples --format text"],
    ["check:package", "npm run build && npm run check:package:contents && npm run check:package-public && npm run check:release-install"],
    ["check:package-public", "node scripts/check-package-public.mjs"],
    ["check:workspace-public", "node scripts/check-workspace-public.mjs"],
    ["check:release-install", "node scripts/check-release-install.mjs"],
    ["check:metadata", "node scripts/check-metadata.mjs"],
    ["check:licenses", "node scripts/check-licenses.mjs"],
    ["check:release-tag", "node scripts/check-release-tag-alignment.mjs"],
    ["check:final-matrix", "node scripts/check-final-certification-matrix.mjs"],
    ["check:readability", "node scripts/check-public-readability.mjs"],
    ["release:publish:dry", "npm run check:release-tag && node scripts/check-publish-dry-run.mjs"],
    ["skills:ci", "npm --prefix agent-skills ci"],
    ["skills:check", "npm --prefix agent-skills run check"],
    ["skills:pack:dry", "npm --prefix agent-skills run pack:dry"]
  ]);

  for (const [name, expected] of expectedScripts) {
    if (scripts[name] !== expected) {
      failures.push(`package script ${name} must be ${JSON.stringify(expected)}.`);
    }
  }
  expectContains(scripts["check:certification"], "npm run check:final-matrix", "check:certification must include check:final-matrix.", failures);
  expectContains(scripts["check:certification"], "npm run check:licenses", "check:certification must include check:licenses.", failures);
  expectContains(scripts["check:certification"], "npm run check:release-tag", "check:certification must include check:release-tag.", failures);
  expectContains(scripts["check:certification"], "npm run check:readability", "check:certification must include check:readability.", failures);
  expectContains(scripts["check:certification"], "npm run skills:check", "check:certification must include skills:check.", failures);

  const workflowChecks = [
    {
      file: ".github/workflows/ci.yml",
      snippets: [
        "matrix:",
        "\"20.x\"",
        "\"22.x\"",
        "\"24.x\"",
        "npm ci",
        "npm --prefix agent-skills ci",
        "npm run build",
        "npm run typecheck",
        "npm test",
        "npm run validate",
        "npm run conformance",
        "npm run check:readability",
        "npm run skills:check"
      ]
    },
    {
      file: ".github/workflows/validate.yml",
      snippets: ["name: Validate", "npm ci", "npm run check:generated", "npm run build", "npm test", "npm run validate", "npm run check:package"]
    },
    {
      file: ".github/workflows/security.yml",
      snippets: [
        "name: Security",
        "npm --prefix agent-skills ci",
        "npm audit --omit=dev --audit-level=high",
        "npm --prefix agent-skills audit --omit=dev --audit-level=high",
        "npm run check:licenses",
        "npm run check:secrets",
        "npm run check:package-public",
        "npm run check:workspace-public"
      ]
    },
    {
      file: ".github/workflows/docs.yml",
      snippets: ["name: Docs", "npm run docs:build"]
    },
    {
      file: ".github/workflows/release-dry-run.yml",
      snippets: [
        "name: Release Dry Run",
        "fetch-depth: 0",
        "npm run check:certification",
        "npm run archive:source",
        "npm run check:source-archive",
        "npm run check:release-tag",
        "npm run release:publish:dry"
      ]
    },
    {
      file: ".github/workflows/publish.yml",
      snippets: [
        "name: Publish",
        "fetch-depth: 0",
        "id-token: write",
        "npm run check:release-tag",
        "npm run check:certification",
        "npm publish --dry-run",
        "npm publish ./agent-skills --dry-run --access public --tag",
        "npm publish ./agent-skills --access public --tag",
        "npm publish --access public"
      ]
    }
  ];

  for (const check of workflowChecks) {
    const content = readText(path.join(root, check.file), failures, check.file);
    if (!content) continue;
    for (const snippet of check.snippets) {
      expectContains(content, snippet, `${check.file} must include ${snippet}.`, failures);
    }
  }

  for (const doc of [
    "docs/public-framework/final-certification-matrix.md",
    "docs/public-framework/v1-certification.md",
    "docs/release.md",
    "docs/public/npm-release-preflight.md"
  ]) {
    if (!existsSync(path.join(root, doc))) {
      failures.push(`Missing final certification matrix doc dependency: ${doc}`);
    }
  }

  const rootPackFiles = packageDryRunFiles(root, failures, "root package");
  const agentPackFiles = packageDryRunFiles(path.join(root, "agent-skills"), failures, "agent-skills package");
  for (const required of ["docs/public-framework/final-certification-matrix.md", "docs/public/license-exceptions.md", "docs/public/npm-release-preflight.md"]) {
    if (!rootPackFiles.includes(required)) {
      failures.push(`Root package dry-run must include ${required}.`);
    }
  }
  for (const required of [
    "README.md",
    ".codex-plugin/plugin.json",
    "docs/skill-index.md",
    "scripts/aicf-skills.mjs",
    "scripts/check-release-install.mjs"
  ]) {
    if (!agentPackFiles.includes(required)) {
      failures.push(`Agent-skills package dry-run must include ${required}.`);
    }
  }

  rejectForbiddenPackageFiles(rootPackFiles, "root package", failures);
  rejectForbiddenPackageFiles(agentPackFiles, "agent-skills package", failures);

  return {
    ok: failures.length === 0,
    checkedWorkflows: workflowChecks.map((check) => check.file),
    rootPackageFileCount: rootPackFiles.length,
    agentSkillsPackageFileCount: agentPackFiles.length,
    failures
  };
}

export function formatFinalCertificationMatrixReport(report) {
  const lines = [];
  lines.push(`Final certification matrix ${report.ok ? "passed" : "failed"}.`);
  lines.push(`Checked workflows: ${report.checkedWorkflows.join(", ")}.`);
  lines.push(`Root package dry-run files: ${report.rootPackageFileCount}.`);
  lines.push(`Agent-skills package dry-run files: ${report.agentSkillsPackageFileCount}.`);
  if (report.failures.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return lines.join("\n");
}

function packageDryRunFiles(cwd, failures, label) {
  try {
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
  } catch (error) {
    failures.push(`Unable to inspect ${label} dry-run contents: ${safeMessage(error)}`);
    return [];
  }
}

function rejectForbiddenPackageFiles(files, label, failures) {
  for (const file of files) {
    const lower = file.toLowerCase();
    const segments = file.split("/");
    if (segments.some((segment) => forbiddenPackageSegments.has(segment))) {
      failures.push(`${label} includes forbidden path segment: ${file}`);
    }
    if (forbiddenPackageExtensions.test(file)) {
      failures.push(`${label} includes forbidden artifact extension: ${file}`);
    }
    if (
      lower.includes("provider-payload")
      || lower.includes("raw-payload")
      || lower.includes("raw-provider")
      || lower.includes("raw-prompt")
      || lower.includes("raw-trace")
      || lower.includes("local-backup")
    ) {
      failures.push(`${label} includes forbidden raw/local-looking file: ${file}`);
    }
  }
}

function readJson(file, failures, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`Unable to read ${label}: ${safeMessage(error)}`);
    return undefined;
  }
}

function readText(file, failures, label) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    failures.push(`Unable to read ${label}: ${safeMessage(error)}`);
    return "";
  }
}

function expectContains(content, snippet, message, failures) {
  if (!String(content ?? "").includes(snippet)) {
    failures.push(message);
  }
}

function safeMessage(error) {
  return String(error?.stderr ?? error?.message ?? error).replace(/\s+/g, " ").trim().slice(0, 220);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes("--json");
  const report = runFinalCertificationMatrix();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatFinalCertificationMatrixReport(report));
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}
