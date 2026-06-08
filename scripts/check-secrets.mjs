import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const highConfidenceSecretPatterns = [
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
  },
  {
    name: "GitHub token",
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g
  },
  {
    name: "npm token",
    pattern: /\bnpm_[A-Za-z0-9]{36,}\b/g
  },
  {
    name: "Stripe live secret key",
    pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g
  },
  {
    name: "private key block",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g
  }
];

const defaultExcludedSegments = new Set([
  ".git",
  "_private",
  "dist",
  "dist-source",
  "generated-docs",
  "node_modules"
]);

export function runSecretScan(files, options = {}) {
  const root = options.root ?? process.cwd();
  const failures = [];

  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (segments.some((segment) => defaultExcludedSegments.has(segment))) {
      continue;
    }
    if (!isTextFile(normalized)) {
      continue;
    }

    const fullPath = path.join(root, normalized);
    if (!existsSync(fullPath)) {
      continue;
    }

    const content = readFileSync(fullPath, "utf8");
    for (const { name, pattern } of highConfidenceSecretPatterns) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        const value = match[0];
        if (isAllowedSyntheticValue(value, content, match.index ?? 0)) {
          continue;
        }
        failures.push(`${name} candidate in ${normalized}:${lineNumber(content, match.index ?? 0)}`);
      }
    }
  }

  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = gitFiles(["ls-files", "-z"]).concat(gitFiles(["ls-files", "--others", "--exclude-standard", "-z"]));
  const failures = runSecretScan(files);

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`Secret scan passed with ${files.length} candidate file(s).`);
  }
}

function gitFiles(args) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return output.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}

function isTextFile(file) {
  return /\.(cjs|css|html|js|json|md|mjs|ts|txt|yaml|yml)$/.test(file) || !path.extname(file);
}

function isAllowedSyntheticValue(value, content, index) {
  const lower = value.toLowerCase();
  if (
    lower.includes("example")
    || lower.includes("synthetic")
    || lower.includes("placeholder")
    || lower.includes("fake")
  ) {
    return true;
  }

  const context = content.slice(Math.max(0, index - 80), Math.min(content.length, index + value.length + 80)).toLowerCase();
  return context.includes("synthetic") || context.includes("example") || context.includes("placeholder") || context.includes("fake");
}

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}
