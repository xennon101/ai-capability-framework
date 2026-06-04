import path from "node:path";

export const forbiddenPathSegments = new Set([
  ".git",
  ".idea",
  ".vscode",
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
  "test-results",
  "traces"
]);

export const forbiddenExtensions = new Set([
  ".db",
  ".docx",
  ".log",
  ".pdf",
  ".sqlite",
  ".tgz",
  ".xlsx",
  ".zip"
]);

export function publicArtifactFailures(files, options = {}) {
  const failures = [];
  const allowSource = options.allowSource === true;
  const allowScripts = options.allowScripts === true;
  const allowGithub = options.allowGithub === true;

  for (const rawFile of files) {
    const file = normalizePath(rawFile);
    const segments = file.split("/");
    const lowerFile = file.toLowerCase();

    if (!allowGithub && segments.includes(".github")) {
      failures.push(`Forbidden GitHub metadata included: ${file}`);
    }

    if (!allowSource && segments.includes("src")) {
      failures.push(`Source-only path included in package artifact: ${file}`);
    }

    if (!allowScripts && segments.includes("scripts")) {
      failures.push(`Script-only path included in package artifact: ${file}`);
    }

    if (segments.some((segment) => forbiddenPathSegments.has(segment))) {
      failures.push(`Forbidden path included: ${file}`);
    }

    if (segments.some((segment) => segment === ".DS_Store")) {
      failures.push(`Forbidden platform artifact included: ${file}`);
    }

    const extension = path.extname(file).toLowerCase();
    if (forbiddenExtensions.has(extension)) {
      failures.push(`Forbidden artifact type included: ${file}`);
    }

    if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
      failures.push(`Environment file included: ${file}`);
    }

    if (
      lowerFile.includes("provider-payload")
      || lowerFile.includes("raw-payload")
      || lowerFile.includes("raw_provider")
      || lowerFile.includes("raw-prompt")
      || lowerFile.includes("raw_prompt")
      || lowerFile.includes("raw-trace")
      || lowerFile.includes("raw_trace")
      || lowerFile.includes("provider_payload")
    ) {
      failures.push(`Private or provider payload-looking path included: ${file}`);
    }

    if (
      lowerFile.includes("credential")
      || lowerFile.includes("api-key")
      || lowerFile.includes("apikey")
      || lowerFile.includes("access-token")
      || lowerFile.includes("access_token")
    ) {
      failures.push(`Credential-looking path included: ${file}`);
    }
  }

  return failures;
}

export function normalizePath(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}
