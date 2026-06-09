---
name: aicf-capability-authoring
description:
  Author or modify AICF capability/entity manifests, schemas, model-facing slices, and
  starter evals. Use when creating an AI tool, exposing app functionality to models, or
  converting an operation into a governed AICF capability.
license: MIT
compatibility:
  Codex and Agent Skills-compatible coding agents. Works in repositories using AICF or
  migrating to AICF.
metadata:
  aicf.skill.version: "1.0.0"
  aicf.skill.package: "@aicf/agent-skills"
  aicf.skill.category: "capability-authoring"
  aicf.skill.scope: "builder"
  aicf.skill.strictness: "fail-closed-runtime"
---

# AICF Capability Authoring

## Purpose

Guide creation or modification of AICF capability and entity manifests so
model-accessible application operations are precise, governable, testable, and safe to
route.

## Use this skill when

- Creating a new AICF capability manifest for read, prepare, commit, send, or workflow
  operations.
- Turning an application operation into a governed model-facing tool.
- Adding entity manifests, input/output schemas, model-facing descriptions, or starter
  evals.
- Reviewing an existing manifest for safety, lifecycle, routing, and schema quality.

## Do not use this skill when

- Implementing runtime handlers, provider loops, storage adapters, approval UIs, or
  model calls.
- Writing general app APIs that are not being exposed through AICF.
- Creating broad raw backend endpoints instead of capability-sized operations.

## Inputs to inspect first

- `AGENTS.md` and public repository rules.
- Existing `schemas/`, `examples/`, `docs/start-here.md`, and nearby capability/entity
  manifests.
- A target application operation, intended user, lifecycle operation, side effects, and
  risk tier.
- Reference guides: [checklist](references/checklist.md),
  [decision tree](references/manifest-decision-tree.md),
  [field guide](references/field-guide.md), and [examples](references/examples.md).

## Workflow

1. Identify the smallest useful operation and reject broad generic APIs.
2. Choose capability type, lifecycle operation, risk tier, side-effect metadata, and
   required auth/account/tenant context.
3. Draft or update the entity manifest when the capability acts on a domain entity.
4. Write strict object input schemas and output schemas; prefer explicit required fields
   and enums.
5. Add model-facing descriptions that say what the capability does, when to use it, and
   what it will not do.
6. Add starter eval coverage for selection, valid input, invalid input, and forbidden
   commit exposure.
7. Validate the manifests and keep examples synthetic.

Use [capability template](assets/capability.manifest.yaml),
[entity template](assets/entity.manifest.yaml), and
[eval template](assets/eval-case.yaml) as starting points.

## Required outputs

- Capability and, when needed, entity manifests with strict schemas and public-safe
  descriptions.
- A short explanation of lifecycle, risk, side effects, approval/idempotency/audit
  needs, and routing expectations.
- Starter eval cases or a concrete note explaining why no eval was added.

## Validation

- Run the repo manifest validation command.
- Run generated-type checks if schemas changed.
- Confirm the model-facing slice excludes commit capabilities unless a host-only path
  intentionally handles them.
- Confirm examples contain only synthetic identifiers and `example.com` URLs when URLs
  are needed.

## Hard rules

- Do not expose a broad application API as one capability.
- Do not weaken AICF validation to satisfy a provider schema.
- Do not add runtime execution, storage, provider SDK calls, model calls, or approval
  workflows from this skill.
- Do not copy private notes into public manifests or docs.

## Handoff format

Report changed manifests, created evals, validation commands run, safety decisions, and
any remaining gaps or follow-up work.
