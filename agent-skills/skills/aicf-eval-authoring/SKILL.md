---
name: aicf-eval-authoring
description:
  Create AICF capability-aware evals, golden tests, rubrics, deterministic fixtures,
  real-provider test cases, and regression suites. Use for AI quality, tool-choice
  accuracy, action correctness, or model upgrades.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "evals"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Eval Authoring

## Purpose

Guide creation of deterministic, capability-aware evals that prove tool selection, input
validation, policy behavior, lifecycle outcomes, and provider-safe outputs.

## Use this skill when

- Adding eval cases for a new or changed capability.
- Creating golden tests for tool choice, args, policy, or action state.
- Building regression coverage for model upgrades or provider adapter changes.
- Exporting public-safe Promptfoo or live-eval fixtures.

## Do not use this skill when

- Running live provider calls by default.
- Storing transcripts, private prompts, provider transport details, or credentials.
- Replacing AICF validation with provider or eval-tool validation.

## Inputs to inspect first

- Capability manifests, example contexts, existing eval manifests, candidate result
  fixtures, and scorer docs.
- References for [rubrics](references/eval-rubric.md),
  [golden patterns](references/golden-test-patterns.md),
  [deterministic scorers](references/deterministic-scorers.md), and
  [live-provider evals](references/real-provider-evals.md).

## Workflow

1. Identify the capability, risk tier, operation, and behavior being proven.
2. Prefer deterministic fixtures before live-provider cases.
3. Add positive cases for correct selection and valid tool input.
4. Add negative cases for forbidden tools, invalid args, missing context, unsafe
   commits, and private-detail leakage.
5. Add expected action state and policy decision assertions where lifecycle behavior
   matters.
6. Keep live-provider evals opt-in and separated from normal checks.
7. Update docs or indexes only when the public eval surface changes.

Use [eval case](assets/eval-case.yaml), [eval result](assets/eval-result.json), and
[Promptfoo config](assets/promptfoo.config.yaml) templates where useful.

## Required outputs

- Eval cases with clear expected behavior and scorer coverage.
- Candidate result fixtures when deterministic CLI tests need them.
- A short explanation of what behavior the eval proves.

## Validation

- Run the eval command with public candidate results.
- Run manifest validation when fixtures or examples change.
- Confirm evals fail for unsafe or incorrect tool calls.

## Hard rules

- Evals do not call models unless explicitly configured as live tests.
- Do not include private input text, provider transport bodies, credentials, or real
  customer data.
- Do not make eval pass criteria vague for high-risk behavior.
- Do not ignore unknown capability IDs or duplicate candidate results.

## Handoff format

Report eval files added, scorers used, behavior proven, commands run, and known coverage
gaps.
