# Governed Memory And Preferences

AICF memory governance is an optional contract for host-owned memory and
preferences. It helps a host decide whether a summarized memory record may be
shown to a model as context.

Import it from:

```ts
import {
  selectGovernedMemory,
  memoryRecordToContextSegment
} from "ai-capability-framework/memory";
```

The memory subpath does not store memory, recall memory, infer preferences,
embed text, search vectors, call models, or update user profiles. Host
applications own memory storage, consent, deletion, identity resolution, tenant
scoping, and user-facing preference controls.

## Records

`GovernedMemoryRecord` stores a public-safe summary, not raw transcripts or raw
profile data. Each record includes:

- redacted subject/account/tenant refs where relevant;
- a scope such as `user`, `account`, `tenant`, `workflow`, or `session`;
- a purpose and `contentSummary`;
- source provenance, confidence, sensitivity labels, consent basis, allowed use
  cases, disallowed use cases, timestamps, and optional retention policy.

Preferences use the same record shape. For example, a support user preference
can allow `support_refund_preparation` while disallowing cross-tenant support.

## Exposure

`evaluateMemoryExposure(record, context)` fails closed when a record is expired,
out of scope, missing a matching use case, explicitly disallowed, credential
classified, or sensitive without consent.

`selectGovernedMemory(records, context)` evaluates every record, keeps only
allowed records, sorts them by record ID, and applies a default maximum of 20.

Allowed use cases are exact string matches in F12. There is no wildcard or
semantic matching.

## Context Conversion

`memoryRecordToContextSegment()` converts a selected record into a security
`ContextSegment` with `instructionsAllowed: false`. Memory is data, not a
system or developer instruction.

`memoryRecordToRuntimeContextItem()` converts a selected record into a runtime
context item for host-controlled context building. It includes purpose,
confidence, scope, sensitivity labels, and the summary without exposing raw
subject IDs or private diagnostics.

Sensitive or credential-classified records still go through the existing
security redaction helpers before crossing provider or trace boundaries.

## Example

The public fixture at
`examples/support/memory/support.agent.preferences.json` is synthetic. It shows
a support preference summary with redacted refs and an explicit use-case allow
list. It is validated by `npm run validate`.

```bash
npm run validate
npm run test:memory
```

## Boundaries

AICF does not decide what should be remembered. It only helps a host govern
whether a host-supplied memory summary may be used for a specific request.

Do not put raw prompts, raw provider payloads, raw transcripts, credentials,
tenant IDs, account IDs, user IDs, or customer data in public memory fixtures.
