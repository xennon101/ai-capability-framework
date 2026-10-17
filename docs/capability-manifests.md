# Capability Manifests

A capability manifest is the contract between model-facing intent and application-owned
execution.

See [the 1.0 spec](spec.md) for the shared vocabulary.

## Required Fields

- `schema_version`: Manifest schema version.
- `id`: Stable dotted identifier such as `support.refund.prepare_case`.
- `version`: Semantic version for the capability contract.
- `status`: Lifecycle state such as `draft`, `active`, or `deprecated`.
- `name` and `summary`: Human-readable labels for operators and maintainers.
- `model_description`: Short model-facing description of when to use the capability.
- `capability_type`: The broad action class, such as read, compute, prepare, or commit.
- `autonomy_tier`: Maximum autonomy level allowed for the capability.
- `risk_tier`: Safety and business risk tier.
- `input_schema` and `output_schema`: JSON Schema contracts.
- `side_effects`: Explicit flags for data reads, writes, money movement, external
  messages, permission changes, and irreversible actions.
- `authorization`: Required permissions and scoping rules.
- `policy`: Deny, approval, and review rules.
- `lifecycle`: Explicit prepare, preview, approve, commit, verify, and audit flags.
- `idempotency`: Optional commit idempotency requirements.
- `observability`: Logging and trace expectations.

## Optional Discovery Metadata

The reserved `extensions.discovery` object accepts authored retrieval vocabulary:

```yaml
extensions:
  discovery:
    schema_version: "1.0"
    summary: Read the recorded details of a support ticket.
    aliases:
      - ticket details
      - support case status
```

When present, this object is validated against the
[discovery metadata schema](../schemas/discovery/metadata.schema.json). Its version is
required; summary and aliases are optional. A summary must be nonblank and at most 500
characters. Supply at most 32 nonblank aliases of at most 120 characters each. Other
fields inside this object are rejected; unrelated extensions remain valid.

This metadata does not change default routing, authorization, or execution. The default
router continues to use its existing lexical metadata. Optional retrieval and selection
are available through the [discovery subpath](discovery.md).

## Lifecycle Guidance

Use `write_prepare_only` for capabilities that assemble a proposed action but do not
execute it. Use `write_commit` only when the application can enforce authorization,
idempotency, approval state, verification, and audit.

High-risk capabilities should require explicit approval before commit. Critical
capabilities should usually be split into separate prepare and commit capabilities.

Commit capabilities should be excluded from normal model tool sets until application
code has verified approval and idempotency state.

AICF tooling loads and validates capability manifests, builds registries, evaluates
deterministic select, prepare, and commit decisions, exports adapter metadata, and
scores eval fixtures. It does not execute capabilities, persist actions, collect
approvals, or perform side effects.
