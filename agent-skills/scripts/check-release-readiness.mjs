#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import {
  expectedSkillNames,
  forbiddenPathFailures,
  listSkillDirs,
  loadTriggerFixture,
  normalizePath,
  npmPackFiles,
  packageRoot,
  parseSkillFile,
  publicPackageFailures,
  readJson,
  readText,
  validateSkills
} from "./lib/skill-common.mjs";

const root = packageRoot();
const failures = [];

checkPackageMetadata();
checkPluginMetadata();
checkSkills();
checkTriggerFixtures();
checkDocs();
checkPackContents();
checkPublicScan();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Agent skills release readiness passed.");
}

function checkPackageMetadata() {
  const pkg = readJson(path.join(root, "package.json"));
  expect(pkg.name === "@aicf/agent-skills", "package.json: name must be @aicf/agent-skills.");
  expect(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version), "package.json: version must be semver-like.");
  expect(pkg.private === false, "package.json: private must be false.");
  expect(pkg.license === "MIT", "package.json: license must be MIT.");
  expect(pkg.publishConfig?.access === "public", "package.json: publishConfig.access must be public.");
  expect(pkg.type === "module", "package.json: type must be module.");
  expect(pkg.bin?.["aicf-skills"] === "scripts/aicf-skills.mjs", "package.json: bin.aicf-skills must point to scripts/aicf-skills.mjs.");

  for (const rel of [
    "scripts/validate-skills.mjs",
    "scripts/check-skills-public.mjs",
    "scripts/check-trigger-coverage.mjs",
    "scripts/generate-skill-index.mjs",
    "scripts/install-skills.mjs",
    "scripts/aicf-skills.mjs",
    "scripts/check-release-readiness.mjs"
  ]) {
    requireFile(rel);
  }

  const requiredScripts = {
    validate: "node scripts/validate-skills.mjs ./skills",
    "check:public": "node scripts/check-skills-public.mjs .",
    "check:triggers": "node scripts/check-trigger-coverage.mjs ./skills ./tests/fixtures/trigger-prompts.json",
    index: "node scripts/generate-skill-index.mjs ./skills ./docs/skill-index.md",
    "check:index": "node scripts/generate-skill-index.mjs ./skills ./docs/skill-index.md --check",
    test: "node --test tests/*.test.mjs",
    "check:release": "node scripts/check-release-readiness.mjs",
    "pack:dry": "npm pack --dry-run"
  };
  for (const [scriptName, expected] of Object.entries(requiredScripts)) {
    expect(pkg.scripts?.[scriptName] === expected, `package.json: script ${scriptName} must be "${expected}".`);
  }
  expect(String(pkg.scripts?.check ?? "").includes("npm run check:index"), "package.json: check must include check:index.");
  expect(String(pkg.scripts?.check ?? "").includes("npm run check:release"), "package.json: check must include check:release.");

  for (const requiredFileEntry of [".codex-plugin", "skills", "scripts", "docs", "assets", "README.md", "LICENSE", "CHANGELOG.md"]) {
    expect(pkg.files?.includes(requiredFileEntry), `package.json: files must include ${requiredFileEntry}.`);
  }
}

function checkPluginMetadata() {
  const pkg = readJson(path.join(root, "package.json"));
  const plugin = readJson(path.join(root, ".codex-plugin", "plugin.json"));
  expect(plugin.name === "aicf-agent-skills", ".codex-plugin/plugin.json: name must be aicf-agent-skills.");
  expect(plugin.version === pkg.version, ".codex-plugin/plugin.json: version must match package.json.");
  expect(plugin.license === "MIT", ".codex-plugin/plugin.json: license must be MIT.");
  expect(plugin.skills === "./skills/", ".codex-plugin/plugin.json: skills must be ./skills/.");
  checkRelativeExistingPath(plugin.interface?.composerIcon, "composerIcon");
  checkRelativeExistingPath(plugin.interface?.logo, "logo");
}

function checkSkills() {
  const skillsRoot = path.join(root, "skills");
  const actualNames = listSkillDirs(skillsRoot).map((skillDir) => path.basename(skillDir)).sort();
  const expectedNames = [...expectedSkillNames].sort();
  expect(JSON.stringify(actualNames) === JSON.stringify(expectedNames), `skills/: expected exactly ${expectedNames.length} skills.`);

  for (const failure of validateSkills(skillsRoot, { root })) failures.push(failure);

  const pkg = readJson(path.join(root, "package.json"));
  for (const skillName of expectedNames) {
    const parsed = parseSkillFile(path.join(skillsRoot, skillName, "SKILL.md"));
    expect(parsed.frontmatter.license === "MIT", `${skillName}: license must be MIT.`);
    expect(parsed.frontmatter.metadata?.["aicf.skill.package"] === pkg.name, `${skillName}: metadata package must match package.json.`);
    expect(parsed.frontmatter.metadata?.["aicf.skill.version"] === pkg.version, `${skillName}: metadata version must match package.json.`);
  }
}

function checkTriggerFixtures() {
  const fixture = loadTriggerFixture(path.join(root, "tests", "fixtures", "trigger-prompts.json"));
  const byName = new Map(fixture.skills.map((entry) => [entry.name, entry]));
  for (const skillName of expectedSkillNames) {
    const entry = byName.get(skillName);
    expect(Boolean(entry), `${skillName}: trigger fixture is required.`);
    expect(Array.isArray(entry?.positive) && entry.positive.length > 0, `${skillName}: positive trigger fixtures are required.`);
    expect(Array.isArray(entry?.negative) && entry.negative.length > 0, `${skillName}: negative trigger fixtures are required.`);
  }
}

function checkDocs() {
  const requiredDocs = {
    "README.md": ["builder skills", "not AICF runtime capabilities", "npm run check", "https://developers.openai.com/codex/skills"],
    "docs/installation.md": ["../.agents/skills", "$HOME/.agents/skills", "codex plugin marketplace add", "npm package"],
    "docs/skill-authoring-standard.md": ["frontmatter", "required sections", "one-level", "public-safe"],
    "docs/validation.md": ["npm run check:index", "npm run check:release", "common failures", "expected output"],
    "docs/public-release-checklist.md": ["npm run check", "npm run pack:dry", "plugin manifest", "version consistency"],
    "docs/codex-plugin-distribution.md": [".codex-plugin/plugin.json", "./skills/", "relative asset paths", "Codex plugin"],
    "docs/skill-index.md": expectedSkillNames,
    "skills/README.md": ["17", "source of truth", "install script"]
  };

  for (const [rel, terms] of Object.entries(requiredDocs)) {
    requireFile(rel);
    const content = readText(path.join(root, rel));
    const lowerContent = content.toLowerCase();
    for (const term of terms) {
      expect(lowerContent.includes(String(term).toLowerCase()), `${rel}: must mention ${term}.`);
    }
  }
}

function checkPackContents() {
  const files = npmPackFiles(root);
  const fileSet = new Set(files);
  const requiredFiles = [
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "package.json",
    ".codex-plugin/plugin.json",
    "docs/installation.md",
    "docs/validation.md",
    "docs/public-release-checklist.md",
    "docs/codex-plugin-distribution.md",
    "docs/skill-authoring-standard.md",
    "docs/skill-index.md",
    "assets/aicf-agent-skills-icon.svg",
    "assets/aicf-agent-skills-logo.svg",
    "scripts/aicf-skills.mjs",
    "scripts/check-release-readiness.mjs"
  ];

  for (const skillName of expectedSkillNames) {
    requiredFiles.push(`skills/${skillName}/SKILL.md`);
  }
  for (const rel of requiredFiles) {
    expect(fileSet.has(rel), `npm dry-run package must include ${rel}.`);
  }

  for (const file of files) {
    for (const failure of forbiddenPathFailures(file, "npm package")) failures.push(failure);
    expect(!file.startsWith("tests/"), `npm dry-run package must not include tests: ${file}.`);
    expect(!file.startsWith(".agents/"), `npm dry-run package must not include a local skill mirror: ${file}.`);
    expect(!file.includes("node_modules/"), `npm dry-run package must not include dependencies: ${file}.`);
  }
}

function checkPublicScan() {
  for (const failure of publicPackageFailures(root)) failures.push(failure);
}

function checkRelativeExistingPath(value, label) {
  expect(typeof value === "string" && value.length > 0, `.codex-plugin/plugin.json: ${label} is required.`);
  if (typeof value !== "string") return;
  expect(!path.isAbsolute(value), `.codex-plugin/plugin.json: ${label} must be relative.`);
  expect(!/^[a-z]+:/i.test(value), `.codex-plugin/plugin.json: ${label} must not be a URL.`);
  const normalized = normalizePath(value);
  expect(!normalized.startsWith("../"), `.codex-plugin/plugin.json: ${label} must stay inside the package.`);
  requireFile(normalized);
}

function requireFile(rel) {
  expect(existsSync(path.join(root, rel)), `${rel}: required file is missing.`);
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}
