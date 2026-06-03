# AI Capability Framework

AI Capability Framework (AICF) is a small public framework for describing what an
AI-enabled application is allowed to know, decide, and do.

The repository contains:

- JSON Schema contracts for capability, entity, and eval manifests.
- Synthetic examples that show how to describe a capability without exposing
  private application internals.
- A validation script for checking examples against the schemas.
- Short instructions for designing capabilities, policies, action lifecycles,
  and regression evals.

## Why This Exists

AI products are easier to govern when model-facing behavior is represented as
explicit application capabilities instead of broad tool lists or hidden prompts.
AICF separates semantic interpretation from deterministic application control:

- Models interpret the user goal and select from a small set of relevant
  capabilities.
- Application code validates inputs, checks authorization, enforces policy,
  executes side effects, and records audit evidence.
- Evals verify that capability selection, tool arguments, approval boundaries,
  and safety behavior remain stable.

## Quick Start

Install dependencies and validate the public examples:

```bash
npm install
npm run validate
```

Create a capability manifest:

```yaml
schema_version: "0.1"
id: support.refund.prepare_case
version: 1.0.0
status: active
name: Prepare refund case
summary: Prepare a refund case for review without issuing money.
capability_type: write_prepare_only
autonomy_tier: A2
risk_tier: medium
```

Then add input/output schemas, side-effect metadata, authorization rules, policy
gates, observability settings, and eval references.

## Repository Layout

```text
schemas/   JSON Schema contracts for AICF manifests
examples/  Synthetic public example capabilities, entities, and evals
docs/      Public usage guidance
scripts/   Local validation utilities
```

Private drafts and source material are intentionally excluded from this public
repository. See `AGENTS.md` for the tracking boundary used in this workspace.

## Core Concepts

Capability manifest:
Describes a model-selectable application capability, including its input/output
contract, risk tier, side effects, authorization requirements, policy gates, and
observability expectations.

Entity manifest:
Describes an application entity that capabilities may read or act on. It records
canonical identifiers, data classification, relationships, and model-facing
guidance.

Eval case:
Describes a regression case for capability selection, argument extraction,
approval boundaries, refusals, and safety behavior.

Action lifecycle:
Side-effecting capabilities should generally follow a prepare, preview, approve,
commit, verify, and audit lifecycle. Low-risk read or compute capabilities can
use simpler flows when policy allows it.

## Validation

`npm run validate` parses all schema files, then validates every YAML/JSON
example under:

- `examples/**/capabilities/`
- `examples/**/entities/`
- `examples/**/evals/`

The script fails on malformed examples or schema violations.

