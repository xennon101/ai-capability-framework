import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rootMarkdown = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "ROADMAP.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md"
];

const publicJson = [
  "package.json",
  "agent-skills/package.json",
  "agent-skills/.codex-plugin/plugin.json"
];

const ignoredSegments = new Set([
  ".git",
  ".aicf",
  "_private",
  "coverage",
  "dist",
  "dist-source",
  "generated-docs",
  "node_modules"
]);

export function runPublicReadabilityCheck(root = repoRoot) {
  const failures = [];

  for (const file of publicMarkdownFiles(root)) {
    failures.push(...checkMarkdownFile(root, file));
  }

  for (const file of workflowFiles(root)) {
    failures.push(...checkMinimumLineCount(root, file, 5, "Workflow YAML"));
  }

  for (const relative of publicJson) {
    failures.push(...checkMinimumLineCount(root, path.join(root, relative), 5, "Public JSON"));
  }

  return failures;
}

function publicMarkdownFiles(root) {
  const files = [
    ...rootMarkdown.map((file) => path.join(root, file)),
    ...walk(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
    ...walk(path.join(root, "examples")).filter((file) => path.basename(file) === "README.md"),
    path.join(root, "agent-skills", "README.md"),
    ...walk(path.join(root, "agent-skills", "docs")).filter((file) => file.endsWith(".md")),
    ...walk(path.join(root, "agent-skills", "skills")).filter((file) => path.basename(file) === "SKILL.md")
  ];
  return [...new Set(files)].filter((file) => existsSync(file));
}

function workflowFiles(root) {
  const directory = path.join(root, ".github", "workflows");
  return walk(directory).filter((file) => /\.ya?ml$/iu.test(file));
}

function checkMarkdownFile(root, file) {
  const relative = normalize(path.relative(root, file));
  const lines = readFileSync(file, "utf8").split(/\r?\n/u);
  const failures = [];
  let longNonTableLines = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    if (/^#{1,6}\s+\S/u.test(trimmed) && looksLikeCollapsedHeading(trimmed)) {
      failures.push(`${relative}:${lineNumber} looks like a collapsed heading/body line.`);
    }

    const fenceMatches = trimmed.match(/(?:```|~~~)/gu) ?? [];
    if (fenceMatches.length >= 2) {
      failures.push(`${relative}:${lineNumber} starts and ends a fenced code block on one line.`);
    }

    if (!looksLikeTableLine(trimmed) && trimmed.length > 240) {
      longNonTableLines += 1;
    }

    if (looksLikeCollapsedTable(trimmed)) {
      failures.push(`${relative}:${lineNumber} looks like a collapsed Markdown table.`);
    }
  });

  if (longNonTableLines > 5) {
    failures.push(`${relative} has ${longNonTableLines} non-table line(s) over 240 characters.`);
  }

  return failures;
}

function looksLikeCollapsedHeading(line) {
  const headingText = line.replace(/^#{1,6}\s+/u, "");
  const words = headingText.split(/\s+/u).filter(Boolean);
  if (line.length > 160 && /[.!?]\s+\S/u.test(headingText)) return true;
  if (words.length >= 16 && /[.!?]/u.test(headingText)) return true;
  return false;
}

function looksLikeTableLine(line) {
  return line.startsWith("|") && line.endsWith("|");
}

function looksLikeCollapsedTable(line) {
  const separatorCount = (line.match(/\|\s*:?-{3,}:?\s*\|/gu) ?? []).length;
  const pipeCount = (line.match(/\|/gu) ?? []).length;
  if (separatorCount >= 1 && pipeCount >= 10) return true;
  return pipeCount >= 8 && line.includes("---") && !looksLikeTableLine(line);
}

function checkMinimumLineCount(root, file, minimum, label) {
  if (!existsSync(file)) return [];
  const relative = normalize(path.relative(root, file));
  const lineCount = readFileSync(file, "utf8").split(/\r?\n/u).length;
  return lineCount < minimum ? [`${relative} must be readable multiline ${label}; found ${lineCount} line(s).`] : [];
}

function walk(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalize(file) {
  return file.replaceAll("\\", "/");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runPublicReadabilityCheck();
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Public readability check passed.");
  }
}
