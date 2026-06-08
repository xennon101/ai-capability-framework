---
name: aicf-provider-conformance
description:
  "Validate AICF capabilities across provider and framework adapters: OpenAI, Anthropic
  Claude, Google Gemini, Vercel AI SDK, MCP, LangChain/LangGraph, and Semantic
  Kernel-compatible workflows."
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0-rc.4"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "provider-conformance"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Provider Conformance

## Purpose

Guide provider and framework conformance work so one routed AICF capability slice maps
safely and reversibly across supported descriptor and runtime bridges.

## Use this skill when

- Validating OpenAI, Anthropic Claude, Google Gemini, Vercel AI SDK, MCP,
  LangChain/LangGraph, or Semantic Kernel-compatible exports.
- Checking schema normalization, tool-name mapping, reverse binding, tool-call parsing,
  or model-safe tool results.
- Running or updating a cross-provider conformance matrix.

## Do not use this skill when

- Adding a new provider runtime implementation.
- Calling live models or provider APIs.
- Weakening AICF schemas to satisfy a provider.
- Building a model gateway.

## Inputs to inspect first

- Provider adapter code, shared provider helpers, conformance tests, fixtures, schemas,
  docs, and public examples.
- References: [provider matrix](references/provider-normalization-matrix.md),
  [schema compatibility](references/schema-compatibility.md),
  [tool-call mapping](references/tool-call-mapping.md), and
  [runtime boundaries](references/provider-runtime-boundaries.md).

## Workflow

1. Identify the target provider or framework bridge.
2. Export descriptors from the routed read/prepare slice.
3. Validate provider-safe names, collision handling, and reverse binding.
4. Validate schema normalization and deterministic diagnostics for unsupported schema
   features.
5. Validate tool-call parsing, arg validation, and unknown-tool handling.
6. Validate model-safe result envelopes and approval-required behavior.
7. Confirm commit capabilities are not exported or executable.
8. Run or update the conformance matrix with structured pass/fail output.

Use [conformance case](assets/provider-conformance-case.yaml) and
[provider matrix](assets/provider-matrix.json) templates as starting points.

## Required outputs

- Provider conformance changes or a conformance report summary.
- Diagnostics for unsupported schema features, collisions, invalid args, and unsafe
  exports.
- Tests or fixtures proving provider-safe behavior.

## Validation

- Run provider conformance tests and package checks relevant to the repo.
- Confirm root/runtime imports remain free of optional provider SDK requirements.
- Confirm provider outputs never include private diagnostics or raw transport bodies.

## Hard rules

- AICF validation remains canonical.
- Reverse mapping must use generated bindings, not guessed provider names.
- Commit capabilities must not be model-exposed.
- Live provider calls must stay opt-in.

## Handoff format

Report providers checked, descriptors exported, failures or warnings, tests run, and
remaining conformance gaps.
