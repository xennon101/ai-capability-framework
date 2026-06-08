---
name: aicf-action-lifecycle
description: Implement or audit AICF propose, prepare, preview, approve, commit, verify, audit, idempotency, and rollback-safe action workflows for side-effecting AI capabilities.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "action-lifecycle"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Action Lifecycle

## Purpose

Guide implementation or review of side-effect workflows so prepare, approval, commit, verify, idempotency, and audit paths stay host-controlled and fail closed.

## Use this skill when

- Adding or auditing prepare, approval, commit, verify, audit, or idempotency behavior.
- Linking prepare capabilities to host-controlled commit capabilities.
- Testing state transitions for side-effecting capabilities.

## Do not use this skill when

- Creating read-only capability manifests.
- Exposing commit tools to models.
- Building production approval UI or durable storage unless explicitly requested.

## Inputs to inspect first

- Capability lifecycle metadata, linked prepare/commit IDs, runtime action manager, stores, audit sink, handlers, and tests.
- References: [state machine](references/action-state-machine.md), [approval patterns](references/approval-patterns.md), [idempotency and audit](references/idempotency-and-audit.md), and [verification patterns](references/verification-patterns.md).

## Workflow

1. Identify side effects: create, update, delete, send, money movement, permission changes, external workflows, or irreversible effects.
2. Keep the model-exposed operation read or prepare by default.
3. Link prepare to the allowed commit capability explicitly.
4. Wire prepared action, approval, idempotency, audit, and verification paths.
5. Enforce valid transitions: proposed, prepared, approval required, approved, rejected, committed, failed, expired, cancelled.
6. Prevent duplicate commits with scoped idempotency.
7. Mark failed commit attempts as failed and preserve audit evidence.
8. Add tests for every valid and invalid transition.

Use [action handler template](assets/action-handler.template.ts), [prepared action record](assets/prepared-action-record.json), and [approval record](assets/approval-record.json) as safe examples.

## Required outputs

- Lifecycle implementation or audit notes with linked prepare/commit behavior.
- Tests for success, approval, rejection, expiry, duplicate commit, invalid transition, and handler failure.
- Safe audit/idempotency summary.

## Validation

- Run runtime lifecycle tests and package checks used by the repository.
- Confirm commit uses stored prepared action args.
- Confirm terminal states cannot return to pending or approved.

## Hard rules

- Commit must not be executable through model-originated tool calls.
- Commit must require the correct stored prepared action and approval when policy requires it.
- Invalid output, thrown handler, or failed commit must move the action to failed.
- Do not store private raw data in audit records.

## Handoff format

Report lifecycle states changed, handlers wired, idempotency scope, audit evidence, tests run, and remaining approval/storage obligations.
