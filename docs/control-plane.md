# Control Plane

Phase 3 adds deterministic decision APIs for capability selection, preparation,
and commit gating. The control plane does not execute capabilities, store action
state, call models, or enforce host application authorization.

## Decision API

Use `decideCapability(registry, request)` with a registry built from validated
manifests.

The request includes:

- `capabilityId`
- `operation`: `select`, `prepare`, or `commit`
- `args`
- `context.permissions`
- `context.autonomyTier`
- optional `facts`
- optional `approval`
- optional `idempotencyKey`

The result includes:

- `status`: `allowed`, `approval_required`, or `denied`
- `reasons`
- `requiredApprovals`
- `policy`
- `lifecycle`
- `audit` preview

The audit preview is not persisted and has no timestamp. Host applications own
real audit logging.

## Policy Semantics

- Missing permissions deny.
- Autonomy above the capability tier or policy max tier denies.
- `select` decisions check tool-set eligibility with permissions and autonomy.
- `prepare` and `commit` decisions evaluate fact-dependent policy rules.
- `deny_if` rules read `facts[rule]`.
- A true deny fact denies.
- A missing deny fact fails closed and denies.
- `approval_required_if` can return `approval_required` for prepare decisions.
- Commit decisions missing required approval deny.
- Commit decisions missing required idempotency deny.

## CLI

Run a decision from a JSON request file:

```bash
npm run build
node dist/cli.js decide examples --request examples/support/decisions/support.refund.commit_case.allowed.json
```

Denied decisions still exit `0` because the decision was evaluated
successfully. Invalid manifests, invalid request files, and unknown capability
IDs exit nonzero.
