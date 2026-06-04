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
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "docs/ai-sdk-runtime.md",
  "docs/anthropic-runtime.md",
  "docs/glossary.md",
  "docs/gemini-runtime.md",
  "docs/langchain-runtime.md",
  "docs/mcp-server-runtime.md",
  "docs/openai-walkthrough.md",
  "docs/provider-conformance.md",
  "docs/providers.md",
  "docs/semantic-kernel-runtime.md",
  "docs/start-here.md",
  "examples/providers/ai-sdk-next/README.md",
  "examples/providers/anthropic-claude/README.md",
  "examples/providers/gemini/README.md",
  "examples/providers/langchain-agent/README.md",
  "examples/providers/langgraph-tool-node/README.md",
  "examples/providers/mcp/README.md",
  "examples/providers/provider-conformance/README.md",
  "examples/providers/semantic-kernel-mcp/README.md",
  "examples/providers/semantic-kernel-openapi/README.md",
  "package.json"
];
const requiredPrefixes = [
  "conformance/",
  "dist/",
  "docs/",
  "examples/",
  "schemas/"
];
const forbiddenSegments = new Set([
  ".github",
  "_private",
  "coverage",
  "dist-test",
  "drafts",
  "generated-docs",
  "local",
  "logs",
  "node_modules",
  "private",
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
