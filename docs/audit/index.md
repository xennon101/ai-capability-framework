# Audit Ledger

The audit subpath defines canonical ledger records for AICF runtime evidence. It is
optional and additive:

```ts
import { DefaultAuditLedger } from "ai-capability-framework/audit";
```

The ledger records policy decisions, action state, approvals, commit outcomes, and
idempotency reservations in a public-safe JSON shape. It does not replace host audit
systems, production storage, authorization, approval UI, payment systems, or
business-side effects.

## What Gets Recorded

The canonical records are:

- `PolicyDecisionRecord`: capability, operation, decision, reasons, autonomy, risk,
  input hash, trace reference, and redacted subject/account/tenant refs.
- `ActionRecord`: lifecycle state from `proposed` through `prepared`,
  `approval_required`, `approved`, `committing`, `committed`, `failed`, `expired`, or
  `cancelled`. Verification is tracked separately with optional `verificationStatus` so
  committed side effects are not reclassified after a verification check fails.
- `ApprovalRecord`: pending, approved, rejected, expired, or cancelled approval
  decisions with redacted requester and decider refs.
- `IdempotencyRecord`: scoped idempotency reservations and completions with a safe
  result reference.

Records store hashes and summaries, not raw input, raw previews, raw result payloads,
raw prompts, provider payloads, stack traces, secrets, user IDs, account IDs, or tenant
IDs.

## Runtime Integration

Pass a ledger to the runtime only when you want canonical evidence records:

```ts
const ledger = new DefaultAuditLedger();

const lifecycle = new AicfActionLifecycleManager({
  approvalStore,
  handlers,
  idempotencyStore,
  ledger,
  policyBroker,
  preparedActionStore,
  registry
});

const executor = new AicfToolExecutor({
  actionLifecycle: lifecycle,
  handlers,
  ledger,
  policyBroker,
  registry
});
```

Without `ledger`, runtime behavior is unchanged. With `ledger`, AICF records evidence
when tool calls are proposed, policy decisions are made, prepare succeeds, approval is
required, approvals are recorded, commits start, commits succeed, commits fail, and
idempotency keys are reserved or completed.

The in-memory ledger stores are reference utilities for tests and local examples.
Production applications should implement the store interfaces using their own durable,
access-controlled audit system.

## Redaction Defaults

`hashAuditValue()` uses deterministic SHA-256 hashes over stable JSON. The redaction
helpers hash subject, account, and tenant identifiers by default.
`diagnosticMode: "unsafe_unredacted"` exists for isolated tests only and should not be
used in production or public examples.

## Schemas

Strict JSON Schemas live under `schemas/audit/`:

- `policy-decision-record.schema.json`
- `action-record.schema.json`
- `approval-record.schema.json`
- `idempotency-record.schema.json`

They are intended for validation, storage contracts, and source review. Host systems may
add their own private storage metadata outside these public record contracts.
