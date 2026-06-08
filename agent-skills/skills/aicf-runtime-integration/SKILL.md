---
name: aicf-runtime-integration
description: Integrate AICF runtime into an application by wiring context builders, capability routers, handler registries, policy brokers, provider runtimes, stores, and tests. Use when connecting AICF to real app code.
license: MIT
compatibility: Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "runtime"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Runtime Integration

## Purpose

Guide app integration work so AICF runtime pieces connect to existing auth, data, policy, and service paths without replacing the application architecture.

## Use this skill when

- Wiring AICF runtime into a route, API server, worker, CLI, service, or test harness.
- Adding context builders, deterministic routers, policy adapters, handler registries, stores, or provider runtime glue.
- Testing read, prepare, policy, handler, and provider tool-call paths.

## Do not use this skill when

- Authoring capability manifests only.
- Building storage adapters, approval UI, live provider calls, or cloud infrastructure.
- Letting model output call app services directly.

## Inputs to inspect first

- App auth/session/account sources, existing service layer, capability manifests, runtime docs, provider docs, and tests.
- References: [runtime checklist](references/runtime-integration-checklist.md), [context builder patterns](references/context-builder-patterns.md), [router patterns](references/capability-router-patterns.md), [handler registry patterns](references/handler-registry-patterns.md), and [policy adapter guidance](references/policy-broker-adapter.md).

## Workflow

1. Identify the app runtime entrypoint and current service boundaries.
2. Locate the source of truth for user, account, tenant, permissions, entitlements, feature flags, and workflow state.
3. Wire a context builder that labels untrusted input and redacts model-facing context.
4. Wire deterministic routing so models receive only selected read/prepare capabilities.
5. Register handlers that call app-owned services, not manifest prose.
6. Add policy broker integration that fails closed for missing or ambiguous context.
7. Add tests for allowed read, denied permission, missing tenant, malformed args, approval required, handler failure, and provider parse failure.

Use [runtime plan](assets/runtime-integration-plan.md), [context builder template](assets/context-builder.template.ts), and [handler registry template](assets/handler-registry.template.ts) as starting points.

## Required outputs

- Runtime integration plan or implementation diff.
- Tests covering allowed, denied, invalid, approval-required, and failure paths.
- Handoff naming app-owned auth, data, policy, provider, and handler boundaries.

## Validation

- Run targeted runtime tests and package checks used by the repository.
- Confirm model-facing slices exclude commit operations.
- Confirm handler failures return safe envelopes without stack traces.

## Hard rules

- Do not introduce a direct model-to-database or model-to-write path.
- Do not trust client-supplied account, tenant, or permission fields.
- Do not make provider code a root import dependency.
- Do not add live provider calls to normal tests.

## Handoff format

Report entrypoints changed, runtime components wired, tests run, safe failure paths, and remaining host obligations.
