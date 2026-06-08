# Action Lifecycle

AICF runtime separates model-facing tool use from host-controlled side effects. Models
may receive read and prepare capabilities. Commit stays behind application code.

## Flow

The runtime lifecycle is:

```text
route -> read or prepare -> approval pending -> approved or rejected -> commit -> optional verify -> audit
```

`AicfToolExecutor` accepts only `read` and `prepare` execution requests. A malformed
model tool call that attempts `commit` is denied safely.

`AicfActionLifecycleManager` is the commit entrypoint. It commits only from a stored
prepared action plus a matching approval when required and an idempotency key when
required by the capability manifest.

## Prepare

Prepare validates:

- capability ID and lifecycle flags;
- input schema;
- runtime policy;
- registered prepare handler;
- output schema for the prepared-action preview.

Successful prepare stores an `AicfPreparedAction`. Prepare capabilities that can later
be committed should declare `lifecycle.commit_capability_id`, and the prepared action
records that linked commit capability. If policy requires approval, the returned
model-safe envelope includes `status: "approval_required"` and a prepared-action
reference.

## Approval

`recordApproval()` records an approval decision for a prepared action and updates the
prepared-action state. It does not build approval UI, verify approvers, or own identity.
Host applications must perform those checks before recording the decision.

## Commit

Commit validates:

- stored prepared action exists and is not expired, rejected, or cancelled;
- requested commit capability matches the prepared action's declared
  `commitCapabilityId`, or the prepared action capability itself supports commit;
- commit capability exists and supports `lifecycle.commit`;
- commit handler exists;
- approval exists, is approved, matches the prepared action, and is not expired;
- idempotency is present when required;
- policy allows commit for the runtime context.

Commit uses the stored prepared action and approval. It does not accept model-provided
raw business arguments. Duplicate idempotency keys return the safe existing result
rather than invoking the handler again.

Failed commit handlers, thrown commit handlers, and invalid commit output move the
prepared action to `failed`. Terminal actions such as committed, failed, expired,
cancelled, and rejected cannot be moved back to approved.

## Verify

`verify()` checks a stored committed action through the committed capability's optional
verify handler. It requires the committed-action reference to match the stored prepared
action, tenant, account, subject, and committed capability.

Verification does not rewrite committed side-effect history. A successful verification
keeps the prepared action state as `committed` and records
`verification.status: "verified"`. A verification failure also keeps state as
`committed` and records `verification.status: "verification_failed"`. Runtime envelopes
mirror this split with `action.state: "committed"` plus `action.verificationStatus`.

If an action is already verified, `verify()` returns the stored verification result
without calling the handler again. Thrown handler errors are redacted in the envelope,
audit event, and optional audit ledger.

In-memory stores are examples and test utilities. Production applications should use
durable stores, such as the optional AWS reference stores or host-owned storage.
