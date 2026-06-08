import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

const repoRoot = process.cwd();
const failures = [];

const rootPackage = readJson("package.json");
const agentPackage = readJson("agent-skills/package.json");
const plugin = readJson("agent-skills/.codex-plugin/plugin.json");
const readme = readText("README.md");
const licenseDecision = readText("docs/public-framework/license-decision.md");

expect(rootPackage.name === "ai-capability-framework", "root package name must be ai-capability-framework.");
expect(rootPackage.private === false, "root package must remain public.");
expect(rootPackage.license === "MIT", "root package license must be MIT.");
expect(rootPackage.publishConfig?.access === "public", "root package publishConfig.access must be public.");
expect(rootPackage.engines?.node === ">=20", "root package engines.node must be >=20.");
expect(isSemverLike(rootPackage.version), "root package version must be semver-like.");
expect(Boolean(rootPackage.repository?.url), "root package repository URL is required.");
expect(Boolean(rootPackage.bugs?.url), "root package bugs URL is required.");
expect(Boolean(rootPackage.homepage), "root package homepage is required.");

expect(agentPackage.name === "@aicf/agent-skills", "agent-skills package name must be @aicf/agent-skills.");
expect(agentPackage.private === false, "agent-skills package must remain public.");
expect(agentPackage.version === rootPackage.version, "agent-skills package version must match root package version.");
expect(agentPackage.license === rootPackage.license, "agent-skills package license must match root package license.");
expect(agentPackage.publishConfig?.access === "public", "agent-skills publishConfig.access must be public.");
expect(agentPackage.engines?.node === rootPackage.engines?.node, "agent-skills engines.node must match root package engines.node.");
expect(Boolean(agentPackage.repository?.url), "agent-skills repository URL is required.");
expect(agentPackage.repository?.directory === "agent-skills", "agent-skills repository.directory must be agent-skills.");

expect(plugin.version === agentPackage.version, "plugin version must match agent-skills package version.");
expect(plugin.license === agentPackage.license, "plugin license must match agent-skills package license.");
expect(plugin.skills === "./skills/", "plugin skills path must be ./skills/.");
expect(relativeAssetExists(plugin.interface?.composerIcon), "plugin composerIcon must be a relative path to an existing asset.");
expect(relativeAssetExists(plugin.interface?.logo), "plugin logo must be a relative path to an existing asset.");

expect(readme.startsWith("# AI Capability Framework (AICF)"), "README title must be AI Capability Framework (AICF).");
expect(readme.includes("provider-agnostic AI capability framework"), "README must describe AICF as a provider-agnostic AI capability framework.");
expect(readme.includes("governed capability layer"), "README must describe AICF as a governed capability layer.");
expect(!readme.includes("AI Capability Framework Core (AICF Core) is"), "README must not present the full framework as AICF Core.");
expect(readme.includes("docs/public-framework/license-decision.md"), "README must link to the license decision.");

expect(licenseDecision.includes("AICF uses the MIT license"), "license decision doc must state MIT.");
expect(licenseDecision.includes("npm run check:metadata"), "license decision doc must mention the metadata gate.");
expect(!/Apache-2\.0|dual-license/i.test(licenseDecision), "license decision doc must not imply Apache or dual licensing.");

for (const skillName of skillNames()) {
  const skillFile = `agent-skills/skills/${skillName}/SKILL.md`;
  const frontmatter = readSkillFrontmatter(skillFile);
  expect(frontmatter.license === agentPackage.license, `${skillName}: license must match agent-skills package license.`);
  expect(frontmatter.metadata?.["aicf.skill.package"] === agentPackage.name, `${skillName}: package metadata must match agent-skills package name.`);
  expect(frontmatter.metadata?.["aicf.skill.version"] === agentPackage.version, `${skillName}: version metadata must match agent-skills package version.`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("AICF metadata consistency checks passed.");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function isSemverLike(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function relativeAssetExists(value) {
  if (typeof value !== "string" || !value.startsWith("./") || value.includes("..")) {
    return false;
  }

  return existsSync(path.join(repoRoot, "agent-skills", value));
}

function skillNames() {
  return readdirSync(path.join(repoRoot, "agent-skills", "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readSkillFrontmatter(relativePath) {
  const content = readText(relativePath);
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
  if (!match) {
    failures.push(`${relativePath}: missing YAML frontmatter.`);
    return {};
  }

  return parseYaml(match[1]) ?? {};
}
