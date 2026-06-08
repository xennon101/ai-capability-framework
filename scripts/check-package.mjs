import { execFileSync } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const args = npmExecPath ? [npmExecPath, "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"];
const output = execFileSync(command, args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
const packResult = JSON.parse(output)[0];
const files = packResult.files.map((file) => file.path.replaceAll("\\", "/")).sort();

const requiredExact = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "LICENSE",
  "ROADMAP.md",
  "README.md",
  "SECURITY.md",
  "dist/conformance/index.js",
  "dist/control-plane/index.js",
  "dist/evidence/index.js",
  "dist/evalops/index.js",
  "dist/memory/index.js",
  "dist/provenance/index.js",
  "docs/ai-sdk-runtime.md",
  "docs/anthropic-runtime.md",
  "docs/assets/aicf-logo.svg",
  "docs/assets/aicf-mark.svg",
  "docs/audit/index.md",
  "docs/aws/cloudwatch-telemetry.md",
  "docs/aws/dynamodb-single-table.md",
  "docs/aws/kms-redaction.md",
  "docs/aws/production-reference.md",
  "docs/aws/step-functions-approval.md",
  "docs/aws-runtime.md",
  "docs/controls/index.md",
  "docs/evalops.md",
  "docs/evidence.md",
  "docs/glossary.md",
  "docs/index.md",
  "docs/core/capability-manifests.md",
  "docs/core/entity-manifests.md",
  "docs/control-plane/overview.md",
  "docs/evals/golden-tests.md",
  "docs/evals/overview.md",
  "docs/getting-started/concepts.md",
  "docs/getting-started/installation.md",
  "docs/getting-started/quickstart.md",
  "docs/governance/gate.md",
  "docs/governance/impact-and-compatibility.md",
  "docs/governance/index.md",
  "docs/governance/lifecycle.md",
  "docs/governance/overview.md",
  "docs/governance/risk-compiler.md",
  "docs/observability/overview.md",
  "docs/public-framework/compatibility-policy.md",
  "docs/public-framework/deprecation-policy.md",
  "docs/public-framework/release-process.md",
  "docs/public-framework/security-disclosure.md",
  "docs/public-framework/v1-certification.md",
  "docs/providers/anthropic.md",
  "docs/providers/gemini.md",
  "docs/providers/langchain-langgraph.md",
  "docs/providers/mcp.md",
  "docs/providers/openai.md",
  "docs/providers/semantic-kernel.md",
  "docs/providers/vercel-ai-sdk.md",
  "docs/runtime/action-lifecycle.md",
  "docs/runtime/policy-broker.md",
  "docs/runtime/runtime-overview.md",
  "docs/runtime/tool-result-envelope.md",
  "docs/security/overview.md",
  "docs/security/trust-taint-redaction.md",
  "docs/security/security-packs.md",
  "docs/gemini-runtime.md",
  "docs/langchain-runtime.md",
  "docs/memory.md",
  "docs/provenance.md",
  "docs/mcp-server-runtime.md",
  "docs/openai-walkthrough.md",
  "docs/provider-conformance.md",
  "docs/providers/conformance.md",
  "docs/providers.md",
  "docs/evals/replay-and-trace-to-golden.md",
  "docs/semantic-kernel-runtime.md",
  "docs/start-here.md",
  "schemas/governance/compatibility-diff.schema.json",
  "schemas/governance/gate-config.schema.json",
  "schemas/governance/gate-report.schema.json",
  "schemas/governance/impact-report.schema.json",
  "schemas/governance/lifecycle-transition.schema.json",
  "schemas/governance/risk-compilation-result.schema.json",
  "schemas/memory/governed-memory-fixture.schema.json",
  "schemas/memory/governed-memory-record.schema.json",
  "schemas/provenance/generated-content-provenance.schema.json",
  "schemas/provenance/provenance-adapter-hook-result.schema.json",
  "schemas/audit/action-record.schema.json",
  "schemas/audit/approval-record.schema.json",
  "schemas/audit/idempotency-record.schema.json",
  "schemas/audit/policy-decision-record.schema.json",
  "schemas/aws/approval-task.schema.json",
  "schemas/aws/budget-usage.schema.json",
  "schemas/aws/dynamodb-item.schema.json",
  "schemas/aws/telemetry-event.schema.json",
  "schemas/conformance/conformance-case.schema.json",
  "schemas/conformance/conformance-report.schema.json",
  "schemas/conformance/provider-target-matrix.schema.json",
  "schemas/controls/budget-policy.schema.json",
  "schemas/controls/circuit-breaker-policy.schema.json",
  "schemas/controls/control-decision.schema.json",
  "schemas/controls/kill-switch.schema.json",
  "schemas/control-plane/state.schema.json",
  "schemas/evalops/braintrust-dataset.schema.json",
  "schemas/evalops/openai-eval-dataset.schema.json",
  "schemas/evidence/evidence-export-input.schema.json",
  "schemas/evidence/evidence-pack.schema.json",
  "schemas/replay/replay-result.schema.json",
  "schemas/replay/replay-trace.schema.json",
  "schemas/replay/trace-to-golden-options.schema.json",
  "schemas/security-packs/coverage-report.schema.json",
  "schemas/security-packs/promptfoo-red-team-config.schema.json",
  "schemas/security-packs/security-case-suite.schema.json",
  "schemas/security-packs/security-pack.schema.json",
  "schemas/security/context-segment.schema.json",
  "schemas/security/redaction-policy.schema.json",
  "schemas/security/retention-policy.schema.json",
  "schemas/security/source-ref.schema.json",
  "examples/providers/ai-sdk-next/README.md",
  "examples/providers/anthropic-claude/README.md",
  "examples/providers/gemini/README.md",
  "examples/providers/langchain-agent/README.md",
  "examples/providers/langgraph-tool-node/README.md",
  "examples/providers/mcp/README.md",
  "examples/providers/provider-conformance/README.md",
  "examples/providers/semantic-kernel-mcp/README.md",
  "examples/providers/semantic-kernel-openapi/README.md",
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
  "examples/11-control-plane/README.md",
  "examples/aicf.config.yaml",
  "examples/aws/README.md",
  "examples/control-plane/README.md",
  "examples/control-plane/fixtures/control-plane.seed.json",
  "examples/control-plane/public/index.html",
  "examples/control-plane/server.mjs",
  "examples/support/replay/support.refund.approval_required.trace.json",
  "examples/support/memory/support.agent.preferences.json",
  "examples/support/provenance/support.refund.summary.provenance.json",
  "security-packs/approval_bypass.yaml",
  "security-packs/prompt_injection_direct.yaml",
  "security-packs/unsafe_commit_attempt.yaml",
  "package.json"
];
const requiredPrefixes = [
  "conformance/",
  "dist/",
  "docs/",
  "examples/",
  "schemas/",
  "security-packs/"
];
const forbiddenSegments = new Set([
  ".github",
  ".aicf",
  "_private",
  "coverage",
  "dist-test",
  "dist-source",
  "drafts",
  "generated-docs",
  "local",
  "logs",
  "node_modules",
  "private",
  "promptfoo-results",
  "prompts",
  "scripts",
  "src",
  "test-results",
  "traces"
]);
const forbiddenExtensions = new Set([
  ".docx",
  ".log",
  ".pdf",
  ".pptx",
  ".tgz",
  ".xlsx"
]);

const failures = [];

for (const required of requiredExact) {
  if (!files.includes(required)) {
    failures.push(`Missing required package file: ${required}`);
  }
}

for (const prefix of requiredPrefixes) {
  if (!files.some((file) => file.startsWith(prefix))) {
    failures.push(`Missing required package directory: ${prefix}`);
  }
}

for (const file of files) {
  const segments = file.split("/");
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    failures.push(`Forbidden package path included: ${file}`);
  }

  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (file.includes(".") && forbiddenExtensions.has(extension)) {
    failures.push(`Forbidden package artifact included: ${file}`);
  }

  const lowerFile = file.toLowerCase();
  if (lowerFile.includes("provider-payload") || lowerFile.includes("raw-payload")) {
    failures.push(`Provider payload-looking path included: ${file}`);
  }

  if (
    lowerFile.includes("credential")
    || lowerFile.includes("api-key")
    || lowerFile.includes("apikey")
    || lowerFile.includes("access-token")
    || lowerFile.includes("access_token")
  ) {
    failures.push(`Credential-looking package path included: ${file}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Package dry run passed with ${files.length} file(s).`);
}
