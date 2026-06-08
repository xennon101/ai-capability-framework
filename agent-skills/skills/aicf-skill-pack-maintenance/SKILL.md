---
name: aicf-skill-pack-maintenance
description: Create, update, validate, test, and release the AICF Agent Skills Pack itself, including SKILL.md frontmatter, trigger descriptions, references, assets, plugin metadata, and public distribution.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "skill-pack-maintenance"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "public-release"
---

# AICF Skill Pack Maintenance

## Purpose

Guide safe maintenance of the AICF Agent Skills package, including skill structure, trigger coverage, references, assets, plugin metadata, package checks, and release readiness.

## Use this skill when

- Creating, updating, validating, testing, or releasing skills inside the AICF Agent Skills package.
- Editing `SKILL.md` frontmatter, trigger descriptions, references, assets, plugin metadata, or package docs.
- Investigating skill overlap, missing fixtures, or public package failures.

## Do not use this skill when

- Building AICF runtime capabilities or app features.
- Installing skills into a user environment unless the user asks.
- Mirroring skill folders into a repository-local discovery directory by default.

## Inputs to inspect first

- Package README, plugin manifest, validation scripts, trigger fixtures, generated index, and changed skill folders.
- References for [skill authoring rules](references/skill-authoring-rules.md), [trigger evaluation](references/trigger-evaluation.md), [overlap prevention](references/overlap-prevention.md), and [plugin packaging](references/plugin-packaging.md).

## Workflow

1. Identify whether the change is skill content, validation tooling, package metadata, docs, or release hygiene.
2. Keep `SKILL.md` concise and move detailed guidance to one-level references.
3. Ensure frontmatter name, description, license, compatibility, and AICF metadata pass validation.
4. Add or update positive and negative trigger fixtures for every real skill.
5. Regenerate the skill index after metadata or trigger changes.
6. Run package validation, trigger coverage, tests, public scan, and pack dry-run.
7. Preserve the package as an independent nested package unless the root repo intentionally changes shape.

Use [skill template](assets/skill-template.md) for new skills.

## Required outputs

- Valid skill folders or package tooling changes.
- Updated trigger fixtures and generated index when skill metadata changes.
- A public-safety and validation handoff.

## Validation

- Run `npm run validate`, `npm run check:triggers`, `npm run index`, `npm run test`, `npm run check:public`, and `npm run check` from the skills package.
- Run root skill script hooks when relevant.
- Confirm package dry-run excludes local/private artifacts.

## Hard rules

- Do not add `allowed-tools` to skills in this package.
- Do not create extra per-skill README or changelog files.
- Do not copy private specs into skill content.
- Do not overwrite user skill folders during install unless `--force` is explicit.

## Handoff format

Report skills changed, fixture/index changes, commands run, public-safety result, and any remaining release blockers.
