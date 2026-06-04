# Action Lifecycle

AICF runtime separates model-facing tool use from host-controlled side effects.
Models may receive read and prepare capabilities. Commit stays behind
application code.

## Flow

The runtime lifecycle is:

```text
route -> read or prepare -> approval pending -> approved or rejected -> commit -> audit
```

`AicfToolExecutor` accepts only `read` and `prepare` execution requests. A
malformed model tool call that attempts `commit` is denied safely.

`AicfActionLifecycleManager` is the commit entrypoint. It commits only from a
stored prepared action plus a matching approval when required and an idempotency
key when required by the capability manifest.

## Prepare

Prepare validates:

- capability ID and lifecycle flags;
- input schema;
- runtime policy;
- registered prepare handler;
- output schema for the prepared-action preview.

Successful prepare stores an `AicfPreparedAction`. If policy requires approval,
the returned model-safe envelope includes `status: "approval_required"` and a
prepared-action reference.

## Approval

`recordApproval()` records an approval decision for a prepared action and updates
the prepared-action state. It does not build approval UI, verify approvers, or
own identity. Host applications must perform those checks before recording the
decision.

## Commit

Commit validates:

- stored prepared action exists and is not expired, rejected, or cancelled;
- commit capability exists and supports `lifecycle.commit`;
- commit handler exists;
- approval exists, is approved, matches the prepared action, and is not expired;
- idempotency is present when required;
- policy allows commit for the runtime context.

Commit uses the stored prepared action and approval. It does not accept
model-provided raw business arguments. Duplicate idempotency keys return the
safe existing result rather than invoking the handler again.

In-memory stores are examples and test utilities. Production applications should
use durable stores, such as the optional AWS reference stores or host-owned
storage.
