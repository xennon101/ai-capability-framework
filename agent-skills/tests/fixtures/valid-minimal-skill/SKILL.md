---
name: valid-minimal-skill
description: Author a small valid AICF test skill. Use when testing skill validation.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents.
metadata:
  aicf.skill.version: "1.0.0-rc.5"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "test"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# Valid Minimal Skill

## Purpose

Provide a small public-safe fixture for validator tests.

## Use this skill when

- Testing the AICF Agent Skills validator.

## Do not use this skill when

- Building a production AICF skill.

## Inputs to inspect first

- `AGENTS.md`

## Workflow

1. Read the task.
2. Keep the fixture minimal.

## Required outputs

- A validation result.

## Validation

- Run the validator.

## Hard rules

- Keep the fixture public-safe.

## Handoff format

Report validation results and blockers.
