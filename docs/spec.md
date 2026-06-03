# AICF v0.1 Spec

This page defines the public contract for AI Capability Framework manifests.
Version `0.1` is intentionally small: it describes capabilities, entities, and
eval cases without prescribing a runtime implementation.

## Manifest Versioning

- Every public manifest uses `schema_version: "0.1"`.
- Capability manifests also include a semantic `version` for that capability's
  application contract.
- Breaking manifest contract changes require a new `schema_version`.
- Capability behavior changes that affect inputs, outputs, policy, side effects,
  or model-facing meaning require a new capability `version`.

## ID Naming

- Capability IDs use at least three dotted lowercase segments, such as
  `support.refund.prepare_case`.
- Entity IDs use PascalCase, such as `Ticket` or `Order`.
- Eval IDs use lowercase dotted segments and should include the capability or
  behavior under test.
- Public examples must use synthetic IDs only.

## Autonomy Tiers

- `A0`: Application-only execution. The model must not directly select or commit
  the capability.
- `A1`: Read or low-risk assistive behavior.
- `A2`: Prepare-only actions that produce a reviewable preview.
- `A3`: Low-risk commits that policy explicitly allows without approval.
- `A4`: Higher-risk commits requiring strong policy controls and audit.
- `A5`: Critical actions. Prefer explicit human approval and separate commit
  paths.

## Risk Tiers

- `none`: No meaningful user, business, data, or operational risk.
- `low`: Limited read or compute risk.
- `medium`: Creates or changes records, prepares consequential actions, or uses
  sensitive context.
- `high`: Sends external messages, moves money, changes permissions, or commits
  consequential state.
- `critical`: Irreversible, regulated, privileged, or safety-critical behavior.

## Capability Types

- `read_data`: Reads application data.
- `retrieve_documents`: Retrieves knowledge or source documents.
- `compute`: Produces deterministic calculations or transformations.
- `write_prepare_only`: Creates a proposed action or preview without committing
  the side effect.
- `write_commit`: Commits a previously allowed and verified side effect.
- `external_message_prepare`: Prepares a message for review.
- `external_message_send`: Sends a message outside the application.
- `workflow_start`: Starts a workflow.
- `workflow_step`: Advances a workflow.
- `human_handoff`: Transfers work to a human queue or reviewer.

## Action Lifecycle

Side-effecting capabilities should make their lifecycle explicit:

- `prepare`: Assemble proposed action state.
- `preview`: Return a reviewable summary of the proposed action.
- `approve`: Record a policy or human approval.
- `commit`: Execute the approved side effect.
- `verify`: Confirm the side effect reached the expected state.
- `audit`: Record durable evidence of the decision and execution path.

Read-only capabilities normally set `audit: true` and the other lifecycle flags
to `false`. Commit capabilities should not be exposed in normal model tool sets
unless the application has already verified approval and idempotency state.

## Idempotency

Commit capabilities may declare idempotency metadata:

- `idempotency.required`: whether commit decisions require an idempotency key.
- `idempotency.key_fields`: optional manifest guidance for stable key inputs.

The framework only decides whether a key is required and present. Host
applications own idempotency storage and replay protection.

## Public-Safe Examples

- Use fake users, tenants, tickets, orders, approvals, and amounts.
- Use `example.com` for contacts.
- Do not publish raw prompts, traces, provider payloads, credentials, customer
  records, account IDs, internal project names, or private source documents.
- Keep examples small enough that readers can inspect the full contract.
