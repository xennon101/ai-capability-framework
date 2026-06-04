# Policy Broker

`DefaultPolicyBroker` combines Core manifest decisions with runtime context. It
is deterministic and fail-closed.

Import it from:

```ts
import { DefaultPolicyBroker } from "ai-capability-framework/runtime";
```

## Inputs

Policy evaluation receives:

- the loaded capability manifest;
- operation: `select`, `prepare`, or `commit`;
- runtime context with subject, account, tenant, autonomy, risk, facts, and
  metadata;
- args, approval, prepared-action, idempotency, and built context when relevant.

Host applications remain responsible for real authorization, account state,
entitlements, facts, and approval verification. AICF evaluates the information
the host supplies.

## Default Behavior

The broker wraps Core `decideCapability()` and adds runtime checks for:

- missing subject, account, or tenant context;
- missing permissions;
- autonomy and risk ceilings;
- restricted side effects when runtime autonomy forbids them;
- missing, rejected, expired, or mismatched approvals;
- missing idempotency keys when required by the capability.

Ambiguous state denies or pauses. The broker does not guess missing facts or
repair incomplete context.

## Host Hooks

An optional host policy hook may return a stricter decision:

- `denied` can override `allowed` or `approval_required`;
- `approval_required` can override `allowed`;
- `allowed` cannot override an AICF denial.

Thrown hooks fail closed. Hook diagnostics must stay safe for logs and must not
include secrets, raw prompts, provider payloads, or customer data.
