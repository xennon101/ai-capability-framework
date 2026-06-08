---
name: aicf-docs-and-examples
description: Update AICF public docs, quickstarts, examples, README files, API references, provider guides, and sample apps so they match current public contracts and implementation.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "docs-examples"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Docs And Examples

## Purpose

Guide updates to public AICF docs and examples so they are accurate, simple, implementation-aligned, and public-safe.

## Use this skill when

- Updating README, quickstarts, API docs, provider guides, release docs, or example apps.
- Adding docs for changed schemas, commands, exports, providers, runtime behavior, governance, security, or evals.
- Reviewing docs for public safety and current implementation accuracy.

## Do not use this skill when

- Implementing runtime/provider behavior without a docs task.
- Copying private specs or local notes into public docs.
- Adding examples that require credentials or live calls by default.

## Inputs to inspect first

- Changed public contracts, README, docs index, examples, API docs, package scripts, changelog, and validation commands.
- References: [docs style guide](references/docs-style-guide.md), [example app checklist](references/example-app-checklist.md), [public API docs](references/public-api-docs.md), and [quickstart template](references/quickstart-template.md).

## Workflow

1. Identify the public contract, command, export, schema, provider, CLI, or example that changed.
2. Update the smallest set of public docs and examples needed to keep the learning path accurate.
3. Keep provider-neutral docs neutral and label provider-specific docs clearly.
4. Include exact commands and short expected output excerpts when useful.
5. Keep examples synthetic, credential-free by default, and runnable or explicitly documented as docs-only.
6. Run docs, example, validation, and public-safety checks available in the repo.
7. Update changelog or release notes when public behavior changed.

Use [example README template](assets/example-readme-template.md) and [provider guide template](assets/provider-guide-template.md) for new docs.

## Required outputs

- Updated public docs/examples aligned with implementation.
- Commands run and any blockers for examples that cannot be executed.
- Public-safety notes for synthetic data and optional live steps.

## Validation

- Run docs checks, package checks, validation, and example tests relevant to the change.
- Confirm Markdown links resolve when link checking is available.
- Confirm no private or local-only material is included.

## Hard rules

- Do not copy private material verbatim.
- Do not include credentials, account-specific IDs, private traces, or provider transport bodies.
- Do not present optional live integrations as default behavior.
- Do not make docs broader than the implemented public contract.

## Handoff format

Report docs/examples changed, commands run, expected output added, public-safety checks, and remaining docs gaps.
