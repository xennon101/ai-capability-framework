---
name: aicf-governance-lifecycle
description:
  Manage AICF capability lifecycle, risk compiler rules, compatibility checks, and
  impact analysis. Use when moving capabilities through draft, review, approved, canary,
  production, deprecated, disabled, or removed states.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "governance"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Governance Lifecycle

## Purpose

Guide lifecycle, risk, compatibility, and impact work for AICF capabilities without
mutating production behavior or bypassing review gates.

## Use this skill when

- Promoting, deprecating, disabling, or removing a capability.
- Reviewing inferred risk, required controls, or security/eval coverage.
- Comparing manifest versions for compatibility.
- Assessing impact across entities, evals, policies, providers, and linked
  prepare/commit paths.

## Do not use this skill when

- Implementing runtime handlers, provider adapters, storage, UI workflows, or model
  loops.
- Changing manifest status without review evidence.
- Treating warnings as permission to ignore safety or runtime correctness errors.

## Inputs to inspect first

- Current and proposed capability manifests.
- Governance docs, eval/security coverage, conformance results, and release rules.
- References for [lifecycle states](references/lifecycle-state-machine.md),
  [risk compiler rules](references/riskcompiler-rules.md),
  [compatibility checks](references/compatibility-checks.md), and
  [impact analysis](references/impact-analysis.md).

## Workflow

1. Determine the current lifecycle state from request context or manifest status
   mapping.
2. Validate manifests and identify safety/runtime errors before considering promotion.
3. Compile inferred risk and compare it with declared risk.
4. Check required evals, security packs, policy metadata, owner evidence, and control
   states.
5. Compare old and new manifest versions when changing a public contract.
6. Analyze direct impact on entities, evals, policy references, provider exports, and
   linked lifecycle capabilities.
7. Produce an allowed/blocked lifecycle decision with required actions.

Use [lifecycle request](assets/lifecycle-change-request.md) and
[risk waiver](assets/riskwaiver.md) templates when documenting review evidence.

## Required outputs

- Lifecycle decision with reasons, warnings, blockers, and required actions.
- Risk control summary and compatibility classification.
- Impact report with missing coverage gaps.

## Validation

- Run manifest validation and the governance command or tests relevant to the change.
- Confirm high/critical capabilities have required controls or explicit public-safe
  waivers.
- Confirm deprecated or removed capabilities include replacement and migration notes.

## Hard rules

- Do not mutate manifests while evaluating lifecycle unless the user explicitly requests
  an implementation step.
- Do not promote a capability with missing required context, unsafe risk metadata, or
  failing eval/security gates.
- Do not turn terminal removed state back into an active state.
- Do not copy private review notes into public governance evidence.

## Handoff format

Summarize transition requested, decision, blockers, required evidence, commands run, and
exact follow-up changes needed.
