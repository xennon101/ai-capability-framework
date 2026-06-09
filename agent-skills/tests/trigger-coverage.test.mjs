import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkTriggerCoverage,
  packageRoot
} from "../scripts/lib/skill-common.mjs";

const root = packageRoot();

test("empty trigger fixture passes before real skills exist", () => {
  const result = checkTriggerCoverage(path.join(root, "skills"), path.join(root, "tests", "fixtures", "trigger-prompts.json"));
  assert.deepEqual(result.failures, []);
});

test("unknown fixture and missing required term fail", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aicf-trigger-"));
  try {
    const skillsRoot = path.join(temp, "skills");
    mkdirSync(path.join(skillsRoot, "sample-skill"), { recursive: true });
    writeFileSync(path.join(skillsRoot, "sample-skill", "SKILL.md"), validSkill(), "utf8");
    const fixture = path.join(temp, "trigger-prompts.json");
    writeFileSync(fixture, JSON.stringify({
      skills: [
        {
          name: "sample-skill",
          positive: ["create a sample"],
          negative: ["publish a release"],
          required_description_terms: ["missing-term"]
        },
        {
          name: "unknown-skill",
          positive: ["unknown"],
          negative: ["other"],
          required_description_terms: []
        }
      ]
    }), "utf8");
    const result = checkTriggerCoverage(skillsRoot, fixture);
    assert.match(result.failures.join("\n"), /missing required term/);
    assert.match(result.failures.join("\n"), /unknown skill/);
    assert.ok(result.warnings.length > 0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("missing positive and negative examples fail", () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aicf-trigger-empty-"));
  try {
    const skillsRoot = path.join(temp, "skills");
    mkdirSync(path.join(skillsRoot, "sample-skill"), { recursive: true });
    writeFileSync(path.join(skillsRoot, "sample-skill", "SKILL.md"), validSkill(), "utf8");
    const fixture = path.join(temp, "trigger-prompts.json");
    writeFileSync(fixture, JSON.stringify({
      skills: [{ name: "sample-skill", positive: [], negative: [], required_description_terms: ["sample"] }]
    }), "utf8");
    const result = checkTriggerCoverage(skillsRoot, fixture);
    assert.match(result.failures.join("\n"), /positive trigger examples/);
    assert.match(result.failures.join("\n"), /negative trigger examples/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

function validSkill() {
  return `---
name: sample-skill
description: Author a sample AICF skill. Use when testing trigger coverage.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "test"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# Sample Skill

## Purpose
Test.
## Use this skill when
Test.
## Do not use this skill when
Test.
## Inputs to inspect first
Test.
## Workflow
Test.
## Required outputs
Test.
## Validation
Test.
## Hard rules
Test.
## Handoff format
Test.
`;
}
