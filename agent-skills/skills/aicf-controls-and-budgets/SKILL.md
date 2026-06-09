---
name: aicf-controls-and-budgets
description:
  Implement or audit AICF capability-level kill switches, circuit breakers, budgets, max
  loops, rate controls, and fail-safe read-only modes without replacing a model gateway.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "controls-budgets"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Controls And Budgets

## Purpose

Guide AICF operational controls so capability exposure, execution, provider loops, and
side effects can be denied, downgraded, budgeted, or forced through approval.

## Use this skill when

- Adding or auditing kill switches, circuit breakers, budgets, max loops, rate controls,
  or read-only modes.
- Blocking provider/model/capability usage before runtime execution.
- Testing that controls fail closed without creating a model gateway.

## Do not use this skill when

- Adding provider runtimes, production storage, UI dashboards, or cloud resources.
- Silently falling back to another provider after a control denial.
- Exposing commit tools to models.

## Inputs to inspect first

- Controls schemas, runtime router/executor/lifecycle code, provider loops, governance
  gate, policy broker, and tests.
- References: [control types](references/control-types.md),
  [budget policy](references/budget-policy.md), and
  [circuit breakers](references/circuit-breakers.md).

## Workflow

1. Identify control scopes: global, provider, model, capability, domain, tenant,
   autonomy, risk, and environment.
2. Add kill switches for deny, force approval, and read-only behavior.
3. Add circuit breakers for validation failures, policy denials, approval rejections,
   provider errors, cost spikes, latency spikes, loop limits, or suspected cross-tenant
   issues.
4. Add budgets for max tool calls, provider calls, runtime duration, retries, tokens,
   cost, tenant/account, capability, and provider fallback.
5. Wire controls into routing, tool execution, lifecycle commit/verify, and provider
   loops.
6. Return safe denied envelopes or safe provider errors when controls block a path.
7. Add tests for disabled capability, forced approval, read-only mode, max loop, and
   budget exceeded.

Use [controls policy](assets/controls-policy.yaml) and
[budget fixture](assets/budget-fixture.json) as examples.

## Required outputs

- Controls implementation or audit notes with scopes and reason codes.
- Tests proving route/export/execution/provider loops fail closed.
- Handoff explaining host-owned storage and operational responsibilities.

## Validation

- Run controls, runtime, provider mock, governance gate, or package checks relevant to
  the change.
- Confirm denied controls prevent handler/provider calls before side effects.
- Confirm controls are optional unless configured.

## Hard rules

- Do not create a general model gateway.
- Do not hide control failure with silent fallback.
- Do not execute prepare or commit when read-only controls apply.
- Do not require live credentials or cloud resources for tests.

## Handoff format

Report controls added, scopes, decisions, runtime/provider seams touched, tests run, and
remaining host operations work.
