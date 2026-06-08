# Glossary

Capability: An application action or read operation that a model may request. A
capability has an ID, input/output schemas, risk metadata, lifecycle rules, policy
gates, and eval links.

Manifest: A public YAML or JSON file that describes an AICF contract. Capability,
entity, eval, decision, context, and result manifests are validated before use.

Registry: The validated in-memory collection of manifests. AICF uses the registry for
routing, provider export, decisions, execution checks, and eval scoring.

Slice: A small filtered set of capabilities for one request or workflow. Slices keep the
model tool list focused and exclude unsafe or irrelevant capabilities.

Adapter: Code that converts AICF capabilities into another provider or framework tool
shape. Descriptor adapters do not call models or execute handlers.

Provider Runtime: An optional bounded model/tool loop for a specific provider, such as
OpenAI, Anthropic, or Gemini. It still routes through AICF validation, policy, and
runtime envelopes.

Handler: Host application code registered for a capability. Handlers read data or
prepare actions; commit handlers are invoked only by the lifecycle manager.

Executor: The runtime component that validates a read or prepare request, checks policy,
calls the registered handler, validates output, and returns a model-safe envelope.

Lifecycle Manager: The runtime component that prepares actions, records approvals,
checks idempotency, commits stored prepared actions, and emits audit summaries.

Prepared Action: A stored action preview created before side effects happen. It contains
the validated arguments and summary needed for approval and later commit.

Approval: A host-controlled decision that allows or rejects a prepared action. AICF can
record and check approvals, but the host owns the approval UI and real authority.

Idempotency: A key-based protection against duplicate commits. It lets the lifecycle
manager return an existing result instead of repeating a side effect.

Envelope: A JSON-serializable result wrapper returned to the model or host. Envelopes
make success, validation errors, denials, approval-required pauses, unavailable
handlers, and failures explicit.

Eval: A deterministic test case that describes expected model/tool behavior. AICF evals
do not call models; they score candidate result fixtures.

Candidate Result: A public-safe summary of observed behavior for an eval case. It
records selected capabilities, tool calls, policy decisions, action state, refusal, and
response text without raw provider payloads.

Conformance: A descriptor/mock check that one routed capability slice maps consistently
across providers and frameworks. It verifies names, bindings, schemas, safe errors, and
no commit exposure.
