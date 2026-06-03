# Capability Manifests

A capability manifest is the contract between model-facing intent and
application-owned execution.

## Required Fields

- `schema_version`: Manifest schema version.
- `id`: Stable dotted identifier such as `support.refund.prepare_case`.
- `version`: Semantic version for the capability contract.
- `status`: Lifecycle state such as `draft`, `active`, or `deprecated`.
- `name` and `summary`: Human-readable labels for operators and maintainers.
- `model_description`: Short model-facing description of when to use the
  capability.
- `capability_type`: The broad action class, such as read, compute, prepare, or
  commit.
- `autonomy_tier`: Maximum autonomy level allowed for the capability.
- `risk_tier`: Safety and business risk tier.
- `input_schema` and `output_schema`: JSON Schema contracts.
- `side_effects`: Explicit flags for data reads, writes, money movement,
  external messages, permission changes, and irreversible actions.
- `authorization`: Required permissions and scoping rules.
- `policy`: Deny, approval, and review rules.
- `observability`: Logging and trace expectations.

## Lifecycle Guidance

Use `write_prepare_only` for capabilities that assemble a proposed action but do
not execute it. Use `write_commit` only when the application can enforce
authorization, idempotency, approval state, verification, and audit.

High-risk capabilities should require explicit approval before commit. Critical
capabilities should usually be split into separate prepare and commit
capabilities.

