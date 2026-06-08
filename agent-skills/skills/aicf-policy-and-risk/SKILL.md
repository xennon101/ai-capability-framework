---
name: aicf-policy-and-risk
description: Implement or audit AICF policy broker, risk tiers, semantic invariants, tenant isolation, permissions, entitlements, approval requirements, and fail-closed runtime decisions.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "policy-risk"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Policy And Risk

## Purpose

Guide implementation or review of policy decisions so AICF capabilities fail closed, respect tenant/account/user context, and keep side effects under host authority.

## Use this skill when

- Adding or auditing a policy broker, decision request, or risk tier rule.
- Checking tenant isolation, permissions, entitlements, autonomy, approvals, or idempotency.
- Investigating why a capability should be denied, allowed, or approval-required.
- Adding tests for semantic invariants or runtime decision behavior.

## Do not use this skill when

- Creating provider adapters, model loops, long-running workflows, or storage systems.
- Granting the model authority to override host policy.
- Weakening validation to make a tool call pass.

## Inputs to inspect first

- Capability manifests, policy docs, runtime context builder, router, executor, and lifecycle manager.
- Existing tests for decisions, approvals, idempotency, and invalid args.
- References for [policy broker contract](references/policy-broker-contract.md), [risk tiers](references/risktier-rules.md), [decision matrix](references/deny-approval-allow-matrix.md), and [semantic invariants](references/semantic-invariants.md).

## Workflow

1. Identify the capability, operation, risk tier, side effects, lifecycle state, and required context.
2. Verify user, account, tenant, permission, autonomy, and entitlement inputs come from host-controlled context.
3. Apply semantic invariants before policy hooks.
4. Let host hooks only make decisions stricter.
5. Return structured deny, approval-required, or allow decisions with safe reason codes.
6. Add tests for missing context, invalid args, risk ceilings, approval requirements, and hook failures.
7. Keep policy decision records public-safe.

Use [policy broker template](assets/policy-broker.template.ts) and [decision fixture](assets/policy-decision-fixture.json) as safe starting points.

## Required outputs

- Policy or risk changes with reason codes and tests.
- Updated docs or fixtures only when public contracts change.
- A clear statement of denied, approval-required, and allowed paths.

## Validation

- Run targeted runtime/policy tests and the package check relevant to the repo.
- Confirm errors are safe and stack traces or internal diagnostics are not model-facing.
- Confirm policy failures do not call handlers or commit side effects.

## Hard rules

- Fail closed when context, args, policy state, or host hooks are missing or ambiguous.
- Do not allow host hooks to turn a denial into allow.
- Do not expose commit to model-originated tool execution.
- Do not store raw identifiers in public evidence by default.

## Handoff format

List decisions changed, reason codes, tests added, commands run, and any remaining host integration obligations.
