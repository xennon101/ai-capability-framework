import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  packageRoot,
  validateSkillDirectory,
  validateSkills
} from "../scripts/lib/skill-common.mjs";

const root = packageRoot();

test("valid minimal skill passes", () => {
  const skillDir = path.join(root, "tests", "fixtures", "valid-minimal-skill");
  assert.deepEqual(validateSkillDirectory(skillDir, { root }), []);
});

test("empty skills directory is valid before real skills exist", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aicf-empty-skills-"));
  try {
    assert.deepEqual(validateSkills(temp, { root: temp }), []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("invalid skill cases fail with actionable diagnostics", () => {
  const cases = [
    ["missing-skill-file", "", /missing SKILL\.md/],
    ["name-mismatch", validSkill({ name: "other-name" }), /must match directory name/],
    ["Uppercase", validSkill({ name: "Uppercase" }), /lowercase kebab-case/],
    ["bad--name", validSkill({ name: "bad--name" }), /consecutive hyphens/],
    ["missing-description", validSkill({ description: undefined }), /description is required/],
    ["long-description", validSkill({ description: "a".repeat(1025) }), /description must be <=1024/],
    ["missing-section", validSkill({ omitSection: "Validation" }), /missing required section "## Validation"/],
    ["broken-reference", validSkill({ extraBody: "\n[Broken](references/missing.md)\n" }), /does not exist/],
    ["deep-reference", validSkill({ extraBody: "\n[Deep](references/nested/file.md)\n" }), /must be one-level/],
    ["allowed-tools", validSkill({ extraFrontmatter: "allowed-tools: shell\n" }), /allowed-tools is not permitted/],
    ["secret-marker", validSkill({ extraBody: "\nDo not include sk-test values.\n" }), /OpenAI-style token marker/]
  ];

  for (const [directoryName, content, expected] of cases) {
    const temp = mkdtempSync(path.join(os.tmpdir(), "aicf-invalid-skill-"));
    const skillDir = path.join(temp, directoryName);
    mkdirSync(skillDir, { recursive: true });
    if (content) writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf8");
    try {
      assert.match(validateSkillDirectory(skillDir, { root: temp }).join("\n"), expected);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});

function validSkill(options = {}) {
  const name = options.name ?? "test-skill";
  const description = options.description === undefined
    ? undefined
    : options.description ?? "Author an AICF test skill. Use when testing validation.";
  const descriptionLine = description === undefined ? "" : `description: ${description}\n`;
  const sections = [
    "Purpose",
    "Use this skill when",
    "Do not use this skill when",
    "Inputs to inspect first",
    "Workflow",
    "Required outputs",
    "Validation",
    "Hard rules",
    "Handoff format"
  ].filter((section) => section !== options.omitSection);

  return `---
name: ${name}
${descriptionLine}license: MIT
compatibility: Codex and Agent Skills-compatible coding agents.
${options.extraFrontmatter ?? ""}metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "test"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# Test Skill

${sections.map((section) => `## ${section}\n\n- Fixture content.\n`).join("\n")}
${options.extraBody ?? ""}`;
}
