# Capability Authoring Checklist

- Operation is one narrow application action, not a generic API wrapper.
- Capability ID is stable, domain-scoped, and readable.
- Capability type and lifecycle operation match the host behavior.
- Input schema is an object schema with clear required fields.
- Output schema is explicit enough for evals and consumers.
- Entity references point to public entity manifests where applicable.
- Risk tier, side effects, auth, tenant/account requirements, audit, approval, and idempotency are consistent.
- Model-facing description says what the capability does and does not do.
- Restricted or destructive behavior is not model-exposed as commit.
- Starter evals cover selection, valid input, invalid input, and forbidden action paths.
