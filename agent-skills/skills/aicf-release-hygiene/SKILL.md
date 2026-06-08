---
name: aicf-release-hygiene
description: Prepare safe public AICF releases by checking package contents, source archives, npm dry runs, clean install, CI, docs, secrets, private artifacts, generated files, logs, traces, and provider payload leaks.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "release-hygiene"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "public-release"
---

# AICF Release Hygiene

## Purpose

Guide public release checks for AICF repositories so package and source artifacts are reviewable, installable, and free of private/local material.

## Use this skill when

- Preparing an npm package, source archive, release tag, or release candidate.
- Checking package contents, clean install, CI, docs, changelog, generated files, or public-safety scans.
- Reviewing whether a branch is ready for public release.

## Do not use this skill when

- Publishing a release without an explicit user request.
- Changing runtime behavior or provider integrations as part of release cleanup.
- Treating a working directory archive as a source review artifact.

## Inputs to inspect first

- `package.json`, lockfile, release docs, CI workflows, changelog, README, and package/source check scripts.
- References for [release checklist](references/release-checklist.md), [forbidden artifacts](references/forbidden-artifacts.md), [package smoke tests](references/package-smoke-test.md), and [source archive rules](references/source-archive-rules.md).

## Workflow

1. Inspect `git status --short --ignored` and preserve unrelated dirty work.
2. Run build, tests, validation, package checks, public checks, and docs checks required by the repo.
3. Inspect npm dry-run contents and clean consumer install behavior.
4. Create or check source archives only through repo scripts.
5. Confirm private/local/generated/archive artifacts are excluded.
6. Confirm version, changelog, release notes, and dist-tag guidance.
7. Produce a release report with commands, results, blockers, and residual risk.

Use [release report template](assets/release-report-template.md) for handoff.

## Required outputs

- Command evidence and package/source artifact summary.
- List of blockers, warnings, and exact files or scripts that need follow-up.
- Confirmation that no publish/tag operation happened unless explicitly requested.

## Validation

- Run the repo release or certification gate when available.
- Run package dry-run and inspect included files.
- Run public-safety and secret scans.
- Confirm clean install/import smoke tests pass.

## Hard rules

- Do not publish, tag, or push unless the user explicitly asks.
- Do not include private drafts, local state, generated docs, archives, logs, traces, provider transport bodies, or credentials.
- Do not manually zip the working directory for source review.
- Do not revert unrelated user changes.

## Handoff format

Report branch, dirty state, commands run, package/source contents result, blockers, and release readiness recommendation.
