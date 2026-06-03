# Evals

Eval cases keep capability behavior from drifting as prompts, models, policies,
and routing code change.

Each eval should be synthetic, deterministic, and tied to a specific behavior.
See [the v0.1 spec](spec.md) for public-safe example rules.

## Useful Eval Types

- Capability selection includes the correct capability.
- Capability selection excludes unsafe or premature commit capabilities.
- Extracted arguments match the user request and available context.
- The action remains in a prepared state when approval is required.
- The model refuses or redirects requests outside the allowed policy.
- Tool results and final responses do not expose private implementation detail.
- Commit capabilities remain excluded until approval is verified.

## Public Example Rule

Public examples must use fake identifiers, fake users, fake tenants, and generic
domains. Do not commit real traces, customer records, raw prompts, internal
schemas, or provider payloads.

Phase 2 validation checks that eval files referenced by capability manifests are
present in the loaded manifest bundle.

Decision behavior should be covered with synthetic request examples and tests
for permission denial, autonomy denial, approval requirements, deny facts,
missing facts, approval state, and idempotency keys.

Phase 5 adds a deterministic eval runner for scoring public-safe candidate
result fixtures against eval manifests. See [the eval runner guide](eval-runner.md)
for fixture shape, scorer behavior, and CLI usage.
