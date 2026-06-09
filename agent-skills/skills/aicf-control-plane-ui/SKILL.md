---
name: aicf-control-plane-ui
description:
  Build or audit the optional AICF governance control-plane UI/API for capability
  catalogue, lifecycle, policy decisions, approvals, eval status, traces, controls, and
  evidence export.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "control-plane-ui"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Control Plane UI

## Purpose

Guide optional AICF governance control-plane UI/API work so capability, lifecycle,
approval, eval, trace, control, and evidence views stay dense, safe, and operational.

## Use this skill when

- Building or auditing a docs-only mock, API, self-hosted UI, sample app, or production
  integration for AICF governance.
- Creating capability catalogue, lifecycle, policy decision, approval, eval, trace,
  controls, or evidence export views.
- Testing safe API response shapes and important UI states.

## Do not use this skill when

- Building a generic analytics dashboard.
- Adding production auth, storage, workflow engines, or hosted SaaS behavior.
- Returning private raw data through UI/API responses.

## Inputs to inspect first

- Control-plane contracts, existing example app, UI framework, design system, public
  docs, API tests, and evidence export behavior.
- References: [screens](references/control-plane-screens.md),
  [approval console](references/approval-console.md),
  [operational UX](references/operational-ux.md), and
  [API contracts](references/api-contracts.md).

## Workflow

1. Identify target surface: docs mock, API, self-hosted UI, sample app, or production
   integration.
2. Build dense views for capability catalogue, lifecycle state, risk tier, policy
   decisions, approvals, eval/security status, traces/replay, kill switches, and
   evidence export.
3. Use the project UI framework and design system.
4. Return only safe summaries, hashes, redacted refs, statuses, counts, and reasons.
5. Add loading, empty, error, denied, approval-required, and disabled states.
6. Add accessibility labels and keyboard paths where practical.
7. Add tests for API contracts and critical UI states.

Use [wireframe](assets/control-plane-wireframe.md) and
[UI checklist](assets/ui-acceptance-checklist.md) templates.

## Required outputs

- UI/API implementation or audit notes.
- Tests for safe response shapes, approval paths, controls, evidence export, and UI
  states.
- Public-safety summary for data shown in the control plane.

## Validation

- Run API, UI, package, docs, and public-safety checks relevant to the change.
- Use browser or screenshot verification for user-visible UI changes when practical.
- Confirm private data is not rendered or returned.

## Hard rules

- Host apps own production auth, tenant enforcement, approval identity, storage, and
  retention.
- Do not expose private prompts, transcripts, provider transport bodies, secrets,
  account IDs, tenant IDs, or stack traces.
- Do not model-expose commit paths through the control plane.
- Do not create a hosted product or workflow engine.

## Handoff format

Report surfaces changed, safe data model, tests run, UI verification, and remaining host
deployment obligations.
