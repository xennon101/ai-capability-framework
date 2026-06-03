# Interoperability

AICF describes AI-facing application capabilities. Other frameworks may execute
or orchestrate those capabilities.

Use AICF as the portable contract layer for:

- manifest schemas;
- capability and entity descriptions;
- deterministic selection, prepare, and commit decisions;
- OpenAI Responses tool export metadata;
- deterministic eval result scoring;
- conformance fixtures for public review.

Use host or adjacent runtime frameworks for:

- model providers and prompts;
- handler registration and invocation;
- approval workflows;
- action storage and replay;
- side-effect execution;
- durable audit pipelines;
- production observability.

When integrating with another runtime, keep the boundary explicit: AICF can
validate and decide whether a capability request is allowed, approval-required,
or denied, but the runtime must still enforce real auth, produce facts, execute
or refuse handlers, and persist records.

See [the adapter roadmap](adapter-roadmap.md) for prioritized non-OpenAI
adapter targets and the common no-execution adapter contract.
