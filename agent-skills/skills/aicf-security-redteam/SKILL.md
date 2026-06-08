---
name: aicf-security-redteam
description:
  Generate AICF security and red-team tests for prompt injection, indirect injection,
  tool misuse, data exfiltration, cross-tenant access, approval bypass, schema
  confusion, and unsafe actions.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0-rc.4"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "security-redteam"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Security Redteam

## Purpose

Guide creation of capability-aware security and red-team tests that prove AICF refuses
unsafe tool use, data exposure, approval bypass, and unsafe fallback behavior.

## Use this skill when

- Adding security pack coverage for high-risk or provider-exposed capabilities.
- Testing prompt injection, indirect injection, tool misuse, data exfiltration,
  cross-tenant access, approval bypass, schema confusion, or unsafe actions.
- Exporting public-safe red-team cases for Promptfoo or deterministic evals.

## Do not use this skill when

- Creating harmful instructions outside a controlled synthetic test fixture.
- Running live red-team tests by default.
- Publishing real customer data, sensitive transcripts, credentials, provider transport
  details, or private prompts.

## Inputs to inspect first

- Capability manifests, risk tiers, security-pack assignments, evals, redaction
  policies, provider exports, and policy broker tests.
- References for [security pack mapping](references/security-test-pack-map.md),
  [injection patterns](references/prompt-injection-patterns.md),
  [tool misuse](references/tool-misuse-patterns.md), and
  [acceptance](references/redteam-acceptance.md).

## Workflow

1. Inventory exposed read/prepare capabilities and high/critical risk paths.
2. Add cases for direct injection, indirect injection in retrieved/tool content, tool
   exfiltration, cross-tenant/entity access, approval bypass, schema confusion, tool
   spoofing, and unsafe action attempts.
3. Assert forbidden tool calls and required policy decisions.
4. Add redaction tests for sensitive content and internal diagnostics.
5. Add provider-failure cases that must fail closed.
6. Export Promptfoo red-team configs only as public-safe templates.
7. Verify no test requires live credentials or provider calls by default.

Use [red-team case](assets/redteam-case.yaml) and
[Promptfoo red-team config](assets/promptfoo-redteam.config.yaml) templates as starting
points.

## Required outputs

- Security cases tied to specific capability IDs.
- Required forbidden-tool, policy, redaction, and approval assertions.
- A coverage summary listing remaining security-pack gaps.

## Validation

- Run security-pack or eval tests relevant to the repository.
- Confirm unsafe prompts do not produce unsafe tool calls.
- Confirm public outputs do not expose internal diagnostics or provider transport
  details.

## Hard rules

- Keep all attack content synthetic and controlled.
- Do not include executable exploit code, credentials, real personal data, or private
  examples.
- Do not allow commit paths through model tool calls.
- Do not soften fail-closed behavior to make a red-team case pass.

## Handoff format

List packs covered, capabilities tested, failures found, commands run, and follow-up
mitigations.
