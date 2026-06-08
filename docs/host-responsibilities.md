# Host Responsibilities

AICF defines contracts and deterministic checks. Host applications own runtime behavior.

Host applications MUST provide or enforce:

- model calls and agent loops;
- real user, tenant, role, and permission checks;
- policy facts used by `deny_if` and `approval_required_if`;
- approval collection, approval verification, and approval records;
- handler registries and capability execution;
- side effects such as writes, sends, refunds, workflow starts, and permission changes;
- idempotency storage, replay protection, and conflict handling;
- durable action state, verification state, and audit logs;
- trace redaction and provider payload retention policies.

AICF decision results and audit previews are inputs to host control logic. They are not
proof that a real user is authorized and are not durable audit records.

Public examples in this repository are synthetic. Do not replace host security controls
with example permissions, IDs, or policy facts.
