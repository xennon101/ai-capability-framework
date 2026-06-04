# Runtime Contracts

AICF Runtime is an additive TypeScript subpath for host applications that want
deterministic runtime context, capability routing, policy brokering, handler
execution, action lifecycle control, and model-safe tool result envelopes.

Import runtime APIs from:

```ts
import {
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker
} from "ai-capability-framework/runtime";
```

The runtime subpath does not call models, depend on provider SDKs, or expose
commit through model tool execution. It can execute host-provided read and
prepare handlers, and it can commit only through the lifecycle manager after a
stored prepared action, approval, and idempotency checks. Host applications still
own real auth, payment/account state, durable storage, approval workflows, audit
retention, and provider calls.

The optional OpenAI Responses runtime lives in
`ai-capability-framework/openai`, not this runtime subpath. It uses these
runtime contracts to run a bounded non-streaming model/tool loop with
caller-provided OpenAI-compatible clients.

For a concrete support/refund flow that shows routing, tool export, validation,
approval-required prepare, and host-controlled commit, read the
[OpenAI walkthrough](openai-walkthrough.md).

## Runtime Context

Runtime decisions use an `AicfRuntimeContext` with run and request IDs,
environment, subject identity, account and tenant identity, workflow hints,
autonomy and risk limits, host facts, and metadata.

Production contexts must include user, account, tenant, run, and request
identifiers. Missing required identity or request fields fail safely before
policy or routing decisions continue.

Use `AicfAuthPlatformAdapter` to connect AICF to a host auth/account platform.
`StaticAuthPlatformAdapter` is provided only for tests and examples.

## Context Builder And Redaction

`DefaultContextBuilder` converts user input, workflow metadata, and host-supplied
context items into deterministic `modelContextText`.

The builder labels user text as untrusted, includes approved application context
separately, applies `DefaultRedactionPolicy` before formatting, enforces max item
and character budgets, and rejects raw attachment contents.

Default redaction removes values under obviously sensitive keys such as
passwords, tokens, secrets, API keys, cookies, sessions, card numbers, CVV
values, and private keys. It intentionally does not claim broad PII detection.

## Capability Router

`DefaultCapabilityRouter` builds a compact runtime capability slice without
calling a model or embedding service.

It filters deterministically by capability status, risk ceiling, permissions,
required user/tenant context, explicit include/exclude lists, domain, capability
type, and restricted side effects. Commit, external-send, money-moving,
permission-changing, destructive, and workflow-triggering capabilities are not
exposed by default.

The router scores remaining capabilities with lexical matching over public
capability metadata and workflow hints, then sorts by score, risk, and
capability ID. Model-facing slices expose only `select` and `prepare`
operations.

Use `formatCapabilitySliceForModel()` to render concise model-facing capability
guidance without private diagnostics, internal policy rules, or full output
schemas.

## Policy Broker

`DefaultPolicyBroker` wraps the Core `decideCapability()` control plane and adds
runtime context checks. It fails closed for missing identity, missing
permissions, risk/autonomy violations, rejected or expired approvals, missing
idempotency, and thrown host policy hooks.

Host policy hooks may make a decision stricter by denying or requiring approval.
They cannot override an AICF denial into an allowed decision.

## Handler Registry And Executor

`AicfHandlerRegistry` stores host-provided capability handlers. Duplicate
handler IDs fail during registration, and optional manifest-registry validation
rejects handlers for unknown capabilities.

`AicfToolExecutor` executes `read` and `prepare` requests only. It validates the
capability, lifecycle, input schema, policy, and handler presence before calling
a handler. Handler output is validated against the capability `output_schema`.
Missing handlers return safe unavailable envelopes by default.

The executor rejects `commit` even if a malformed request attempts to pass it.
Commit is host-controlled through `AicfActionLifecycleManager`.

## Action Lifecycle And Stores

`AicfActionLifecycleManager` prepares actions, records approvals, and commits
stored prepared actions. Commit uses stored prepared-action state plus an
approval decision and idempotency key; it does not use model-provided raw args.

The package includes in-memory prepared-action, approval, idempotency, and audit
stores for tests, local demos, and reference implementations. They are not
production-durable stores.

Optional AWS reference stores are available from
`ai-capability-framework/aws` for host applications that want DynamoDB-backed
prepared actions, approvals, idempotency reservations, and audit summaries.
They are adapters around the same runtime interfaces; they do not provision AWS
resources, own auth, or make AWS part of the runtime subpath import.

Audit events are structured summaries for attempts, denials, approval-required
pauses, successes, and failures. They must not contain raw traces, provider
payloads, secrets, or customer data.

See [action lifecycle](action-lifecycle.md) for the prepare, approval, commit,
idempotency, and audit flow. See [policy broker](policy-broker.md) for runtime
policy evaluation and host hook behavior.

## Runtime Envelopes

Runtime tool results use `createToolEnvelope()`,
`toModelSafeToolEnvelope()`, and `serializeToolEnvelopeForModel()`.

Runtime envelopes include run and request IDs, capability ID/version, operation,
status, optional policy/action summaries, safe user messages, and optional
diagnostics. Diagnostics are stripped from model-facing output by default and
are never included for production model output through the default helper.

## Public Example

The synthetic support/billing runtime example runs without credentials:

```bash
npm run build
node examples/runtime-support-billing/run-mock.mjs
```

It loads the support manifests, routes read and prepare capabilities, executes a
ticket read, prepares a refund case that requires approval, records a host
approval, and commits only through `AicfActionLifecycleManager`.
