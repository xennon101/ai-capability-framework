# AICF 1.0 Spec

This page defines the normative public contract for AI Capability Framework
(AICF) 1.0 manifests and deterministic framework behavior.

AICF is a no-execution framework. It describes capabilities, validates public
contracts, builds registries, evaluates deterministic policy/lifecycle decisions,
exports adapter metadata, and scores deterministic eval fixtures. It does not
call models, execute handlers, verify real host authorization, collect
approvals, persist actions, write durable audit logs, or perform side effects.

## Manifest Versioning

- Every 1.0 manifest MUST use `schema_version: "1.0"`.
- AICF 1.0 is a clean cut from the pre-release `0.1` schema. Validators are not
  required to accept `0.1` manifests.
- Capability manifests MUST include a semantic `version` for the application
  capability contract.
- Breaking changes to manifest fields, validation, or deterministic semantics
  MUST use a new schema version.
- Capability behavior changes that affect input, output, policy, side effects,
  lifecycle, model-facing meaning, or eval expectations MUST update the
  capability `version`.
- Vendor or application-specific fields MUST live under `extensions`.

## ID Naming

- Capability IDs MUST use at least three dotted lowercase segments, such as
  `support.refund.prepare_case`.
- Capability ID segments MAY contain lowercase letters, digits, and underscores,
  and MUST start with a lowercase letter.
- Entity IDs MUST use PascalCase, such as `Ticket` or `MeetingInvite`.
- Eval IDs MUST use lowercase dotted segments and SHOULD include the capability
  or behavior under test.
- Public examples MUST use synthetic IDs and `example.com` contacts only.

## Autonomy Tiers

- `A0`: Application-only execution. The model MUST NOT directly select or commit
  the capability in a normal tool set.
- `A1`: Read or low-risk assistive behavior.
- `A2`: Prepare-only behavior that produces a reviewable preview.
- `A3`: Low-risk commits that policy explicitly allows without approval.
- `A4`: Higher-risk commits requiring strong policy controls and audit.
- `A5`: Critical actions. These SHOULD require explicit human approval and
  separate commit paths.

The control plane MUST deny a decision when the request autonomy tier exceeds
the capability autonomy tier or the capability policy max autonomy tier.

## Risk Tiers

- `none`: No meaningful user, business, data, or operational risk.
- `low`: Limited read or compute risk.
- `medium`: Creates or changes records, prepares consequential actions, or uses
  sensitive context.
- `high`: Sends external messages, moves money, changes permissions, or commits
  consequential state.
- `critical`: Irreversible, regulated, privileged, or safety-critical behavior.

Risk tiers are descriptive metadata. Host applications remain responsible for
real enforcement.

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

Restricted side-effect capabilities SHOULD be excluded from broad model tool
sets unless the host has narrowed context and verified the required preconditions.

## Capability Manifests

A capability manifest MUST define model-selectable behavior, inputs, outputs,
risk, autonomy, side effects, authorization requirements, policy gates,
lifecycle flags, observability expectations, and optional eval links.

Schemas are strict by default with `additionalProperties: false`. The embedded
`input_schema` and `output_schema` fields are JSON Schema objects owned by the
capability author. Authors SHOULD keep those schemas strict as well.

`authorization.permissions` declares deterministic permission strings required
by the control plane. AICF checks that the request context includes them; host
applications MUST enforce real identity, tenant, and permission state.

## Entity Manifests

An entity manifest MUST describe a model-relevant application entity, canonical
ID field, data classification, lookup path, allowed actions, and model guidance.

Entity manifests are descriptive. They do not grant access to records and do not
replace application data models or authorization.

## Eval Case Manifests

An eval case manifest MUST describe deterministic expected behavior for a
synthetic user input. Evals MAY cover tool selection, argument extraction,
policy decisions, approval boundaries, refusals, response text, and no-commit
constraints.

Eval cases MUST be public-safe when committed to this repository. They MUST NOT
contain raw prompts, raw traces, provider payloads, customer records, secrets,
internal endpoints, or private documents.

## Eval Result Fixtures

An eval result fixture MUST use `schema_version: "1.0"` and contain `results`.
Each result is keyed by `eval_id` and MAY include selected capabilities, tool
calls, policy decision, action state, committed capabilities, refusal metadata,
response text, and `extensions`.

The eval runner scores summarized candidate behavior only. It MUST NOT call
models, ingest raw provider payloads, execute capabilities, or store traces.

## Policy Semantics

The deterministic control plane evaluates policy from manifest metadata plus a
request context.

- Missing required permissions MUST deny.
- Requested autonomy above capability or policy max MUST deny.
- `deny_if` checks `facts[rule]`. A true fact MUST deny, a false fact allows
  evaluation to continue, and a missing fact MUST fail closed by denying.
- `approval_required_if` evaluates field paths against request args.
- `policy.approval_required` MAY produce an approval-required prepare decision,
  and MUST block commit unless approval is present.
- Required idempotency MUST block commit unless `idempotencyKey` is present.

Host applications own producing facts, verifying approvals, and enforcing real
authorization.

## Lifecycle Semantics

Side-effecting capabilities SHOULD make their lifecycle explicit:

- `prepare`: Assemble proposed action state.
- `preview`: Return a reviewable summary of the proposed action.
- `approve`: Record a policy or human approval.
- `commit`: Execute the approved side effect.
- `verify`: Confirm the side effect reached the expected state.
- `audit`: Record durable evidence of the decision and execution path.

AICF evaluates lifecycle flags only:

- `select` checks model/tool-set eligibility.
- `prepare` requires `lifecycle.prepare: true`.
- `commit` requires `lifecycle.commit: true`, valid approval when required, and
  idempotency when required.
- Decision results include an audit preview. The preview MUST NOT be treated as
  a persisted audit record.

## Idempotency

Commit capabilities MAY declare idempotency metadata:

- `idempotency.required`: whether commit decisions require an idempotency key.
- `idempotency.key_fields`: optional manifest guidance for stable key inputs.

AICF only decides whether a key is required and present. Host applications own
idempotency storage, replay protection, and conflict handling.

## OpenAI Responses Adapter

The OpenAI Responses adapter converts validated capability manifests into
function tool definitions and parses model tool calls back into AICF capability
requests. The adapter MUST NOT call OpenAI or execute tool handlers.

By default, the adapter MUST include only capabilities whose `select` decision is
allowed for the supplied context and SHOULD exclude restricted side-effect
capabilities. Restricted export requires an explicit option and is still gated
by deterministic selection.

## Extensions

`extensions` is the only stable location for vendor, host, or experimental
fields. Core validators MUST allow extension objects without interpreting them.
Portable examples SHOULD avoid relying on extension semantics.

## Public-Safe Examples

- Use fake users, tenants, tickets, orders, meeting IDs, approvals, and amounts.
- Use `example.com` for contacts.
- Do not publish raw prompts, traces, provider payloads, credentials, customer
  records, account IDs, internal project names, or private source documents.
- Keep examples small enough that readers can inspect the full contract.
