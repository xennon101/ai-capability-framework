---
name: aicf-observability-replay
description:
  Add AICF tracing, OpenTelemetry-style events, Langfuse/export adapters, replay
  fixtures, simulation, and trace-to-golden workflows while keeping raw prompts and
  provider payloads redacted by default.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0-rc.5"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "observability-replay"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Observability Replay

## Purpose

Guide traceability, replay, simulation, and trace-to-golden work while keeping sensitive
content out of default telemetry and eval artifacts.

## Use this skill when

- Adding AICF trace events, span metadata, optional observability adapters, replay
  fixtures, or trace-to-golden workflows.
- Testing redaction, provider attribution, replay determinism, or eval score capture.
- Turning sanitized runtime behavior into regression fixtures.

## Do not use this skill when

- Building an observability platform or requiring external SDKs at root import time.
- Capturing raw sensitive model input or provider transport bodies by default.
- Running live providers in normal tests.

## Inputs to inspect first

- Observability modules, runtime trace events, provider loops, eval runner, replay
  fixtures, redaction helpers, and package tests.
- References: [trace span map](references/trace-span-map.md),
  [replay simulation](references/replay-simulation.md),
  [trace-to-golden](references/trace-to-golden.md), and
  [redacted telemetry](references/redacted-telemetry.md).

## Workflow

1. Add trace events for context build, routing, model call, tool call, policy decision,
   prepare, approval, commit, final response, and eval score.
2. Include run ID, provider, model, capability IDs, schema version, selected slice,
   redacted args hash, decision reasons, latency, cost/tokens where available, and
   outcome.
3. Redact sensitive content before sinks, exports, and replay fixtures.
4. Add replay fixture generation for deterministic mock, policy-only, router-only, and
   validation-only paths.
5. Add trace-to-golden drafts with review required by default.
6. Keep OpenTelemetry and Langfuse integration optional and adapter-isolated.
7. Add tests for redaction, provider attribution, sink failure isolation, and replay
   determinism.

Use [replay fixture](assets/replay-fixture.json) and
[trace-to-golden template](assets/trace-to-golden-template.yaml) as examples.

## Required outputs

- Trace/replay implementation or audit notes.
- Sanitized replay or eval draft fixtures where requested.
- Tests proving redaction and deterministic replay behavior.

## Validation

- Run observability, replay, eval, or provider mock tests relevant to the change.
- Confirm trace events contain provider attribution only when metadata supplies it.
- Confirm trace-to-golden output requires human review.

## Hard rules

- Do not capture private model input or provider transport bodies by default.
- Do not let sink failures fail runtime execution.
- Do not make optional observability SDKs required by root/runtime imports.
- Do not commit generated traces or archives.

## Handoff format

Report events added, replay modes covered, redaction behavior, optional adapters
touched, tests run, and remaining review gaps.
