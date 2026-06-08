import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const requiredRootDocs = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "GOVERNANCE.md",
  "ROADMAP.md"
];

export const requiredDocs = [
  "docs/index.md",
  "docs/getting-started/quickstart.md",
  "docs/getting-started/concepts.md",
  "docs/getting-started/installation.md",
  "docs/core/capability-manifests.md",
  "docs/core/entity-manifests.md",
  "docs/runtime/runtime-overview.md",
  "docs/runtime/policy-broker.md",
  "docs/runtime/action-lifecycle.md",
  "docs/runtime/tool-result-envelope.md",
  "docs/providers/openai.md",
  "docs/providers/anthropic.md",
  "docs/providers/gemini.md",
  "docs/providers/vercel-ai-sdk.md",
  "docs/providers/mcp.md",
  "docs/providers/langchain-langgraph.md",
  "docs/providers/semantic-kernel.md",
  "docs/providers/conformance.md",
  "docs/security/overview.md",
  "docs/security/trust-taint-redaction.md",
  "docs/security/security-packs.md",
  "docs/evals/overview.md",
  "docs/evals/golden-tests.md",
  "docs/evals/replay-and-trace-to-golden.md",
  "docs/governance/overview.md",
  "docs/governance/lifecycle.md",
  "docs/governance/risk-compiler.md",
  "docs/governance/impact-and-compatibility.md",
  "docs/observability/overview.md",
  "docs/aws/overview.md",
  "docs/control-plane/overview.md",
  "docs/public-framework/release-process.md",
  "docs/public-framework/compatibility-policy.md",
  "docs/public-framework/deprecation-policy.md",
  "docs/public-framework/security-disclosure.md",
  "docs/public-framework/v1-certification.md"
];

export const numberedExamples = [
  "examples/01-basic-read-capability/README.md",
  "examples/02-prepare-approve-commit/README.md",
  "examples/03-multi-provider-tools/README.md",
  "examples/04-mcp-server/README.md",
  "examples/05-langchain-langgraph-bridge/README.md",
  "examples/06-vercel-ai-sdk-bridge/README.md",
  "examples/07-policy-broker-custom-auth/README.md",
  "examples/08-aws-step-functions-approval/README.md",
  "examples/09-security-packs-promptfoo/README.md",
  "examples/10-trace-to-golden/README.md",
  "examples/11-control-plane/README.md"
];

const requiredIndexLinks = [
  "getting-started/quickstart.md",
  "getting-started/concepts.md",
  "api.md",
  "providers.md",
  "runtime/runtime-overview.md",
  "evals/overview.md",
  "governance/overview.md",
  "security/overview.md",
  "evidence.md",
  "provenance.md",
  "public-framework/release-process.md",
  "public-framework/v1-certification.md"
];

const forbiddenPrivateMarkers = [
  "AICF_Completion_Public_Framework_Spec_for_Codex",
  "AICF_Framework_PRD_Codex",
  "README_FOR_CODEX",
  "CODEX_TASKS",
  "AI_Implementation_Bible_2026",
  "PRODUCT_REQUIREMENTS_AND_TECH_SPEC",
  "rawProviderPayload",
  "raw_provider_payload",
  "rawPrompt",
  "raw_prompt",
  "BEGIN PRIVATE KEY",
  "sk-unsafe"
];

export function runDocsCheck(root = repoRoot) {
  const failures = [];
  const requiredFiles = [...requiredRootDocs, ...requiredDocs, ...numberedExamples, "typedoc.json"];

  for (const file of requiredFiles) {
    if (!existsSync(path.join(root, file))) {
      failures.push(`Missing required docs/DX file: ${file}`);
    }
  }

  const readme = read(root, "README.md");
  for (const phrase of [
    "AICF is not an agent framework. It is a governed capability layer for AI-accessible application functionality.",
    "Models propose; applications validate, authorize, execute, and audit."
  ]) {
    if (!readme.includes(phrase)) {
      failures.push(`README.md missing required positioning phrase: ${phrase}`);
    }
  }

  const docsIndex = read(root, "docs/index.md");
  for (const link of requiredIndexLinks) {
    if (!docsIndex.includes(link)) {
      failures.push(`docs/index.md missing required link: ${link}`);
    }
  }

  for (const example of numberedExamples) {
    const content = read(root, example);
    for (const marker of ["Fake data:", "Command", "Expected output:", "No secrets", "No live provider calls"]) {
      if (!content.includes(marker)) {
        failures.push(`${example} missing required example marker: ${marker}`);
      }
    }
  }

  for (const file of markdownFiles(root)) {
    const relative = normalize(path.relative(root, file));
    const content = readFileSync(file, "utf8");
    for (const marker of forbiddenPrivateMarkers) {
      if (content.includes(marker)) {
        failures.push(`${relative} contains private or raw-payload marker: ${marker}`);
      }
    }
    failures.push(...brokenMarkdownLinks(root, relative, content));
  }

  if (existsSync(path.join(root, "generated-docs"))) {
    const trackedPackageFiles = packageDryRunFiles(root);
    if (trackedPackageFiles.some((file) => file.startsWith("generated-docs/"))) {
      failures.push("generated-docs/ must not be included in npm package dry-run output.");
    }
  }

  return failures;
}

function brokenMarkdownLinks(root, relativeFile, content) {
  const failures = [];
  const directory = path.dirname(path.join(root, relativeFile));
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || shouldIgnoreLink(rawTarget)) continue;

    const target = decodeURIComponent(rawTarget.split("#")[0].split("?")[0]);
    if (!target) continue;

    const resolved = path.resolve(directory, target);
    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      failures.push(`${relativeFile} has broken relative link: ${rawTarget}`);
    }
  }
  return failures;
}

function shouldIgnoreLink(target) {
  return /^(?:https?:|mailto:|#|app:\/\/)/i.test(target);
}

function markdownFiles(root) {
  return [
    ...requiredRootDocs.map((file) => path.join(root, file)).filter((file) => file.endsWith(".md")),
    ...walk(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
    ...walk(path.join(root, "examples")).filter((file) => path.basename(file) === "README.md")
  ];
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "generated-docs", "_private"].includes(entry.name)) {
        files.push(...walk(fullPath));
      }
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function packageDryRunFiles(root) {
  try {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const output = execFileSync(npmCommand, ["pack", "--dry-run", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return JSON.parse(output)[0].files.map((file) => normalize(file.path));
  } catch {
    return [];
  }
}

function read(root, relative) {
  const file = path.join(root, relative);
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : "";
}

function normalize(file) {
  return file.replaceAll("\\", "/");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runDocsCheck();
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("Docs/DX check passed.");
}
