---
name: aicf-migration
description:
  Migrate existing AI tools, prompts, agents, raw function calls, RAG flows, or app
  integrations into AICF capabilities with policy, schemas, evals, runtime handlers, and
  safe rollout.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "migration"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Migration

## Purpose

Guide migration from existing AI tools, agent integrations, RAG flows, or function-call
code into governed AICF capabilities with tests and safe rollout.

## Use this skill when

- Inventorying existing model calls, tool definitions, prompts, app integrations, evals,
  traces, or failure handling.
- Converting broad tools into AICF capability manifests, runtime handlers, policy
  checks, and evals.
- Planning shadow, read-only, canary, production, or rollback migration steps.

## Do not use this skill when

- Creating a brand-new AICF capability with no existing AI surface.
- Replacing app architecture without a migration plan.
- Running live provider calls or moving private transcripts into public examples.

## Inputs to inspect first

- Current AI integration code, tool definitions, app service APIs, data access paths,
  existing evals, docs, and operational constraints.
- References: [migration inventory](references/migration-inventory.md),
  [conversion playbook](references/conversion-playbook.md),
  [rollout plan](references/rollout-plan.md), and
  [legacy tool risk map](references/legacy-tool-riskmap.md).

## Workflow

1. Inventory current model calls, tools, prompts, data access, app integrations, evals,
   traces, and failure handling.
2. Identify broad tools, unsafe data exposure, missing policy, and missing validation.
3. Group operations into capability domains and entity manifests.
4. Create or update capability manifests with schemas, policy, lifecycle, and evals.
5. Replace direct tool exposure with routed AICF capability slices.
6. Wire runtime handlers and policy broker adapters to existing app services.
7. Add deterministic evals and red-team tests before rollout.
8. Plan shadow, read-only, canary, production, and rollback steps.

Use [migration plan](assets/migration-plan.md) and
[legacy tool inventory](assets/legacy-tool-inventory.csv) templates.

## Required outputs

- Migration inventory and target AICF capability plan.
- Manifests, runtime tasks, eval/security coverage, and rollout notes.
- Explicit unsupported behavior or breaking-change list.

## Validation

- Run manifest validation, evals, runtime tests, migration-specific tests, and
  public-safety checks.
- Confirm unsafe broad access is removed or explicitly scoped.
- Confirm rollback and fallback behavior is documented.

## Hard rules

- Do not preserve unsafe broad tool access for convenience.
- Do not publish private prompts, transcripts, traces, or provider transport details.
- Do not weaken policy or validation to match legacy behavior.
- Do not consider migration complete before tests/evals cover core behavior.

## Handoff format

Report current architecture, target capabilities, files changed, tests/evals added,
rollout stage, blockers, and rollback path.
