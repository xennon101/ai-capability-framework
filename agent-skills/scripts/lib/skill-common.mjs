import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

export const requiredSections = [
  "Purpose",
  "Use this skill when",
  "Do not use this skill when",
  "Inputs to inspect first",
  "Workflow",
  "Required outputs",
  "Validation",
  "Hard rules",
  "Handoff format"
];

export const requiredMetadataKeys = [
  "aicf.skill.version",
  "aicf.skill.package",
  "aicf.skill.category",
  "aicf.skill.scope",
  "aicf.skill.strictness"
];

export const skillNamePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const expectedSkillNames = [
  "aicf-action-lifecycle",
  "aicf-capability-authoring",
  "aicf-control-plane-ui",
  "aicf-controls-and-budgets",
  "aicf-docs-and-examples",
  "aicf-eval-authoring",
  "aicf-governance-lifecycle",
  "aicf-migration",
  "aicf-observability-replay",
  "aicf-policy-and-risk",
  "aicf-provider-conformance",
  "aicf-release-hygiene",
  "aicf-runtime-integration",
  "aicf-security-redteam",
  "aicf-skill-pack-maintenance",
  "aicf-storage-and-aws",
  "aicf-trust-redaction-retention"
];

export const publicSafetyPatterns = [
  { label: "OpenAI key marker", pattern: /OPENAI_API_KEY\s*=/i },
  { label: "Anthropic key marker", pattern: /ANTHROPIC_API_KEY\s*=/i },
  { label: "Google key marker", pattern: /GOOGLE_API_KEY\s*=/i },
  { label: "AWS secret marker", pattern: /AWS_SECRET_ACCESS_KEY/i },
  { label: "private key header", pattern: /BEGIN PRIVATE KEY/i },
  { label: "Slack token marker", pattern: /xoxb-/i },
  { label: "GitHub token marker", pattern: /ghp_/i },
  { label: "OpenAI-style token marker", pattern: /sk-/i },
  { label: "AWS access key marker", pattern: /AKIA/i },
  { label: "private path marker", pattern: /_private\//i },
  { label: "raw provider payload marker", pattern: /rawProviderPayload|raw_provider_payload|raw-provider-payload/i },
  { label: "raw prompt marker", pattern: /rawPrompt|raw_prompt|raw-prompt/i },
  { label: "local Windows workspace path", pattern: /C:\\Users\\|C:\\work\\/i }
];

export const forbiddenPackageSegments = new Set([
  ".git",
  "_private",
  "coverage",
  "dist",
  "node_modules",
  ".nyc_output"
]);

export const forbiddenPackageExtensions = new Set([
  ".docx",
  ".har",
  ".key",
  ".log",
  ".p12",
  ".pdf",
  ".pem",
  ".pfx",
  ".tgz",
  ".trace",
  ".zip"
]);

export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function normalizePath(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function resolvePath(root, maybeRelative) {
  if (!maybeRelative) return root;
  return path.resolve(root, maybeRelative);
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readText(file) {
  return readFileSync(file, "utf8");
}

export function writeText(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

export function listSkillDirs(skillsRoot) {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillsRoot, entry.name))
    .sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));
}

export function parseSkillFile(file) {
  const content = readText(file);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content);
  if (!match) {
    throw new Error("SKILL.md must start with YAML frontmatter delimited by ---.");
  }
  const frontmatter = parseYaml(match[1]) ?? {};
  return {
    content,
    frontmatter,
    body: match[2] ?? ""
  };
}

export function validateSkills(skillsRoot, options = {}) {
  const failures = [];
  const skillDirs = listSkillDirs(skillsRoot);

  for (const skillDir of skillDirs) {
    failures.push(...validateSkillDirectory(skillDir, options));
  }

  return failures;
}

export function validateSkillDirectory(skillDir, options = {}) {
  const failures = [];
  const skillName = path.basename(skillDir);
  const skillFile = path.join(skillDir, "SKILL.md");
  const relativeSkill = normalizePath(path.relative(options.root ?? path.dirname(skillDir), skillDir));

  if (!existsSync(skillFile)) {
    return [`${relativeSkill}: missing SKILL.md.`];
  }

  let parsed;
  try {
    parsed = parseSkillFile(skillFile);
  } catch (error) {
    return [`${relativeSkill}/SKILL.md: ${error.message}`];
  }

  const { frontmatter, body, content } = parsed;
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (name !== skillName) failures.push(`${relativeSkill}/SKILL.md: frontmatter name must match directory name "${skillName}".`);
  if (typeof name !== "string" || !skillNamePattern.test(name)) failures.push(`${relativeSkill}/SKILL.md: name must be lowercase kebab-case, 1-64 chars, with no edge hyphens.`);
  if (typeof name === "string" && name.includes("--")) failures.push(`${relativeSkill}/SKILL.md: name must not contain consecutive hyphens.`);
  if (typeof description !== "string" || description.trim().length === 0) failures.push(`${relativeSkill}/SKILL.md: description is required.`);
  if (typeof description === "string" && description.length > 1024) failures.push(`${relativeSkill}/SKILL.md: description must be <=1024 characters.`);
  if (frontmatter.license !== "MIT") failures.push(`${relativeSkill}/SKILL.md: license must be MIT.`);
  if (typeof frontmatter.compatibility !== "string" || frontmatter.compatibility.trim().length === 0) failures.push(`${relativeSkill}/SKILL.md: compatibility is required.`);
  if (typeof frontmatter.compatibility === "string" && frontmatter.compatibility.length > 500) failures.push(`${relativeSkill}/SKILL.md: compatibility must be <=500 characters.`);

  const metadata = frontmatter.metadata;
  if (!metadata || typeof metadata !== "object") {
    failures.push(`${relativeSkill}/SKILL.md: metadata is required.`);
  } else {
    for (const key of requiredMetadataKeys) {
      if (!(key in metadata)) failures.push(`${relativeSkill}/SKILL.md: metadata.${key} is required.`);
    }
  }

  if (/^allowed-tools\s*:/im.test(content)) {
    failures.push(`${relativeSkill}/SKILL.md: allowed-tools is not permitted in S2.`);
  }

  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > 500) failures.push(`${relativeSkill}/SKILL.md: SKILL.md must be <=500 lines.`);

  failures.push(...validateBodySections(relativeSkill, body));
  failures.push(...validateReferences(skillDir, relativeSkill, body));
  failures.push(...validatePublicSafety(skillFile, content, relativeSkill));
  failures.push(...validateSkillSubtree(skillDir, relativeSkill));

  return failures;
}

export function validateBodySections(relativeSkill, body) {
  const failures = [];
  if (!/^#\s+\S/m.test(body)) {
    failures.push(`${relativeSkill}/SKILL.md: body must include a top-level title.`);
  }

  let cursor = -1;
  for (const section of requiredSections) {
    const pattern = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m");
    const match = pattern.exec(body);
    if (!match) {
      failures.push(`${relativeSkill}/SKILL.md: missing required section "## ${section}".`);
      continue;
    }
    if ((match.index ?? 0) < cursor) {
      failures.push(`${relativeSkill}/SKILL.md: section "## ${section}" appears out of order.`);
    }
    cursor = match.index ?? cursor;
  }
  return failures;
}

export function validateReferences(skillDir, relativeSkill, body) {
  const failures = [];
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of body.matchAll(linkPattern)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    const target = rawTarget.split("#")[0].split("?")[0];
    if (!target) continue;
    const normalized = normalizePath(target);
    const parts = normalized.split("/");
    if (!["references", "assets", "scripts"].includes(parts[0]) || parts.length !== 2) {
      failures.push(`${relativeSkill}/SKILL.md: reference "${rawTarget}" must be one-level references/, assets/, or scripts/.`);
      continue;
    }
    const resolved = path.resolve(skillDir, target);
    if (!resolved.startsWith(path.resolve(skillDir)) || !existsSync(resolved)) {
      failures.push(`${relativeSkill}/SKILL.md: reference "${rawTarget}" does not exist.`);
    }
  }
  return failures;
}

export function validateSkillSubtree(skillDir, relativeSkill) {
  const failures = [];
  for (const directory of ["references", "assets"]) {
    const fullPath = path.join(skillDir, directory);
    if (existsSync(fullPath) && readdirSync(fullPath).length === 0) {
      failures.push(`${relativeSkill}/${directory}: directory must not be empty.`);
    }
  }

  for (const file of walk(skillDir, { excludeSegments: new Set(["node_modules"]) })) {
    const relative = normalizePath(path.relative(skillDir, file));
    const content = isTextFile(file) ? readText(file) : "";
    if (content) failures.push(...validatePublicSafety(file, content, `${relativeSkill}/${relative}`));
    try {
      if (file.endsWith(".json")) JSON.parse(content);
      if (file.endsWith(".yaml") || file.endsWith(".yml")) parseYaml(content);
    } catch (error) {
      failures.push(`${relativeSkill}/${relative}: failed to parse ${path.extname(file)}: ${error.message}`);
    }
  }
  return failures;
}

export function validatePublicSafety(file, content, label = normalizePath(file)) {
  const failures = [];
  for (const { label: patternLabel, pattern } of publicSafetyPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) failures.push(`${label}: contains forbidden public-safety marker: ${patternLabel}.`);
  }
  return failures;
}

export function loadTriggerFixture(fixturePath) {
  const data = readJson(fixturePath);
  if (!data || !Array.isArray(data.skills)) {
    throw new Error(`${fixturePath}: expected { "skills": [...] }.`);
  }
  return data;
}

export function checkTriggerCoverage(skillsRoot, fixturePath) {
  const failures = [];
  const warnings = [];
  const skills = skillSummaries(skillsRoot);
  const fixture = loadTriggerFixture(fixturePath);
  const skillNames = new Set(skills.map((skill) => skill.name));
  const fixtureNames = new Set(fixture.skills.map((entry) => entry.name));

  for (const skill of skills) {
    if (!fixtureNames.has(skill.name)) failures.push(`${skill.name}: missing trigger fixture coverage.`);
  }

  for (const entry of fixture.skills) {
    if (!skillNames.has(entry.name)) failures.push(`${entry.name}: trigger fixture references an unknown skill.`);
    if (!Array.isArray(entry.positive) || entry.positive.length === 0) failures.push(`${entry.name}: positive trigger examples are required.`);
    if (!Array.isArray(entry.negative) || entry.negative.length === 0) failures.push(`${entry.name}: negative trigger examples are required.`);
    if ((entry.positive?.length ?? 0) > 0 || (entry.negative?.length ?? 0) > 0) {
      warnings.push(`${entry.name}: trigger prompts are static coverage examples, not model-selection tests.`);
    }

    const skill = skills.find((candidate) => candidate.name === entry.name);
    if (skill) {
      for (const term of entry.required_description_terms ?? []) {
        if (!skill.description.toLowerCase().includes(String(term).toLowerCase())) {
          failures.push(`${entry.name}: description missing required term "${term}".`);
        }
      }
    }
  }

  return { failures, warnings };
}

export function skillSummaries(skillsRoot) {
  return listSkillDirs(skillsRoot).map((skillDir) => {
    const skillFile = path.join(skillDir, "SKILL.md");
    const parsed = parseSkillFile(skillFile);
    const metadata = parsed.frontmatter.metadata ?? {};
    return {
      name: parsed.frontmatter.name,
      directory: skillDir,
      description: parsed.frontmatter.description,
      category: metadata["aicf.skill.category"] ?? "",
      references: existingFiles(path.join(skillDir, "references")),
      primaryTriggerPhrases: triggerPhrases(parsed.frontmatter.description)
    };
  });
}

export function generateSkillIndex(skillsRoot, fixturePath) {
  const skills = skillSummaries(skillsRoot);
  const fixture = existsSync(fixturePath) ? loadTriggerFixture(fixturePath) : { skills: [] };
  const fixtureByName = new Map(fixture.skills.map((entry) => [entry.name, entry]));
  const lines = [
    "# Skill Index",
    "",
    "Generated from the current AICF Agent Skills package.",
    ""
  ];

  if (skills.length === 0) {
    lines.push("No real skill folders exist yet. S3-S5 add the production AICF skills.", "");
    return `${lines.join("\n")}\n`;
  }

  for (const skill of skills) {
    const triggers = fixtureByName.get(skill.name) ?? {};
    lines.push(`## ${skill.name}`);
    lines.push("");
    lines.push(`- Description: ${skill.description}`);
    lines.push(`- Category: ${skill.category || "unspecified"}`);
    lines.push(`- Reference files: ${skill.references.length > 0 ? skill.references.join(", ") : "none"}`);
    lines.push(`- Primary trigger phrases: ${skill.primaryTriggerPhrases.join(", ") || "none"}`);
    lines.push(`- Positive examples: ${(triggers.positive ?? []).join(" | ") || "none"}`);
    lines.push(`- Negative examples: ${(triggers.negative ?? []).join(" | ") || "none"}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function installSkills({ skillsRoot, target, force = false, allowOutside = false, root = packageRoot() }) {
  if (!target) throw new Error("--target is required.");
  const resolvedTarget = path.resolve(expandHome(target));
  const repoRoot = path.resolve(root, "..");
  const home = path.resolve(process.env.USERPROFILE || process.env.HOME || "");

  if (!allowOutside && !resolvedTarget.startsWith(repoRoot) && (!home || !resolvedTarget.startsWith(home))) {
    throw new Error(`Refusing to install outside repository or home without --allow-outside: ${resolvedTarget}`);
  }

  mkdirSync(resolvedTarget, { recursive: true });
  const installed = [];
  for (const skillDir of listSkillDirs(skillsRoot)) {
    const name = path.basename(skillDir);
    const destination = path.join(resolvedTarget, name);
    if (existsSync(destination)) {
      if (!force) throw new Error(`${name}: target already exists. Use --force to overwrite.`);
      rmSync(destination, { recursive: true, force: true });
    }
    cpSync(skillDir, destination, {
      recursive: true,
      filter: (source) => {
        const normalized = normalizePath(path.relative(skillDir, source));
        return !normalized.split("/").some((segment) => ["node_modules", "tests", ".codex-plugin"].includes(segment));
      }
    });
    installed.push(name);
  }
  return { target: resolvedTarget, installed };
}

export function publicPackageFailures(root = packageRoot()) {
  const failures = [];
  const allowlist = loadAllowlist(path.join(root, "docs", "secret-scan-allowlist.md"));
  const packFiles = npmPackFiles(root);

  for (const file of packFiles) {
    failures.push(...forbiddenPathFailures(file, "npm package"));
    const fullPath = path.join(root, file);
    if (!existsSync(fullPath) || !isTextFile(fullPath)) continue;
    const content = readText(fullPath);
    if (file !== "scripts/lib/skill-common.mjs") {
      for (const { label, pattern } of publicSafetyPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content) && !allowlist.has(label)) {
          failures.push(`${file}: contains forbidden public-safety marker: ${label}.`);
        }
      }
    }
    try {
      if (file.endsWith(".json")) JSON.parse(content);
      if (file.endsWith(".yaml") || file.endsWith(".yml")) parseYaml(content);
    } catch (error) {
      failures.push(`${file}: parse failure: ${error.message}`);
    }
  }

  return failures;
}

export function npmPackFiles(root = packageRoot()) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "cmd.exe" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json"]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "npm pack --dry-run --json"]
      : ["pack", "--dry-run", "--json"];
  const output = execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output)[0].files.map((file) => normalizePath(file.path));
}

export function forbiddenPathFailures(file, context = "source") {
  const failures = [];
  const normalized = normalizePath(file);
  const segments = normalized.split("/");
  if (segments.some((segment) => forbiddenPackageSegments.has(segment))) failures.push(`${context}: forbidden path included: ${normalized}`);
  if (segments.some((segment) => segment === ".DS_Store" || segment === "Thumbs.db")) failures.push(`${context}: forbidden platform artifact included: ${normalized}`);
  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) failures.push(`${context}: forbidden environment file included: ${normalized}`);
  const extension = path.extname(normalized).toLowerCase();
  if (forbiddenPackageExtensions.has(extension)) failures.push(`${context}: forbidden artifact type included: ${normalized}`);
  return failures;
}

export function walk(directory, options = {}) {
  if (!existsSync(directory)) return [];
  const excludeSegments = options.excludeSegments ?? new Set();
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excludeSegments.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, options));
    if (entry.isFile()) files.push(fullPath);
  }
  return files.sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)));
}

export function isTextFile(file) {
  return /\.(cjs|css|html|js|json|md|mjs|svg|ts|txt|yaml|yml)$/i.test(file) || !path.extname(file);
}

function existingFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `references/${entry.name}`)
    .sort();
}

function triggerPhrases(description = "") {
  const lower = String(description).replace(/\s+/g, " ").trim();
  const useWhen = lower.match(/\bUse when\b(.+)$/i)?.[1]?.trim();
  if (!useWhen) return [];
  return useWhen.split(/,|\bor\b|\band\b/i).map((part) => part.trim()).filter(Boolean).slice(0, 5);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandHome(value) {
  if (value === "~") return process.env.USERPROFILE || process.env.HOME || value;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    const home = process.env.USERPROFILE || process.env.HOME;
    if (home) return path.join(home, value.slice(2));
  }
  return value;
}

function loadAllowlist(file) {
  if (!existsSync(file)) return new Set();
  return new Set(readText(file).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
}
