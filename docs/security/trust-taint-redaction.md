# Trust, Taint, Redaction, And Retention

The security subpath adds provider-boundary and trace-boundary controls:

```ts
import {
  createContextSegment,
  defaultSecurityRedactionPolicy,
  redactForProvider,
  redactForTrace
} from "ai-capability-framework/security";
```

It does not replace host DLP, privacy review, auth, policy engines,
observability systems, or data retention infrastructure. It gives AICF users a
small public contract for labelling context, keeping untrusted data separate
from instructions, redacting sensitive classes, and evaluating conservative
retention defaults.

## Trust Segments

`ContextSegment` records what a piece of context is, where it came from, and
whether it is allowed to carry instructions.

Only `system_instruction`, `developer_instruction`, and `app_policy` segments
may set `instructionsAllowed: true`. User input, uploaded files, retrieved
documents, tool results, external API results, and model output are data
segments. They can inform the model or host application, but they are not
trusted instructions.

## Taint And Provenance

`SourceRef` records public-safe provenance such as source ID, source type,
trust label, optional URI, content hash, freshness, and retrieval time.

Generated customer-facing content can use
`ai-capability-framework/provenance` to create sidecar metadata that references
these `SourceRef` values. The provenance subpath keeps raw prompts, provider
payloads, transcripts, secrets, and sensitive source content out of generated
content metadata.

`markTainted()` records that content is not trusted for tool input until the
host validates it. This is especially important for model output and tool
results that might contain hostile text such as instructions to ignore policy.

## Redaction

`redactForProvider()` applies policy before content crosses a provider
boundary. `redactForTrace()` applies policy before content enters traces or
observability sinks.

Default behavior is conservative:

- `credential_material` is denied.
- PII, payment, financial, health, legal, and security-sensitive content is
  redacted from traces.
- raw prompts, raw provider payloads, and raw traces are denied by default.
- provider-boundary rules can be scoped by provider ID, capability ID,
  operation, trust label, data classification, and path.

## Retention

`defaultRetentionPolicy()` returns:

- raw prompt retention: `none`
- raw provider payload retention: `none`
- trace metadata retention: `90` days
- audit record retention: `365` days
- eval dataset retention: `365` days
- raw content in eval datasets: `false`

`evaluateRetentionPolicy()` returns allow/deny reasons and warnings. Unsafe
diagnostic raw-content modes must be explicit and should stay out of public
examples and release artifacts.

## Runtime And Observability

Runtime `AicfContextItem` values can be converted into security
`ContextSegment` values with `contextItemToSegment()`.

Host-owned memory and preferences can be governed through
`ai-capability-framework/memory` before they become runtime context. Selected
memory records convert into `ContextSegment` values with
`instructionsAllowed: false`, so memory summaries cannot become hidden
instructions.

Observability trace sanitization continues to support `contentCapture` modes
`none`, `metadata`, and `redacted_content`. When trace attributes include
classification metadata, the security redaction defaults are applied before the
event is collected or forwarded.

## Security Packs

Capability-aware security packs live in
`ai-capability-framework/security-packs`. They generate public-safe test cases
and Promptfoo red-team configs for risks such as prompt injection, approval
bypass, unsafe commit attempts, provider payload exposure, and cross-tenant
access. They do not replace host security review or runtime redaction policy.

See [Capability-aware security packs](security-packs.md).
