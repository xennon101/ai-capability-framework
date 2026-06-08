# Concepts

AICF is not an agent framework. It is a governed capability layer for AI-accessible
application functionality.

Models propose; applications validate, authorize, execute, and audit.

Core concepts:

- A capability is a typed, versioned operation your app may expose to AI.
- A manifest describes the capability, schema, risk, lifecycle, policy, and eval
  coverage.
- A registry is the validated set of capability, entity, and eval manifests.
- A routed slice is the small set of read/prepare capabilities exposed for one request.
- Provider adapters turn a slice into provider-specific tool descriptors.
- Runtime validation maps model tool calls back to capability IDs and validates args
  before any handler runs.
- Commit stays host-controlled through prepared actions, approvals, idempotency, audit
  records, and optional controls.

See the [Glossary](../glossary.md) for short definitions.
