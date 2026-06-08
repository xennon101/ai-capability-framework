# Observability Runtime

AICF observability is an optional set of trace sinks and redaction helpers for runtime
behavior. Import it from:

```ts
import {
  CollectingTraceSink,
  CompositeTraceSink,
  InMemoryTracer,
  OpenTelemetryTraceSink
} from "ai-capability-framework/observability";
```

The package root and runtime subpath do not require OpenTelemetry, Langfuse, or any
provider SDK.

Sanitized runtime traces can be replayed or converted into draft evals through
`ai-capability-framework/replay`. Replay fixtures should contain metadata, hashes,
model-safe envelopes, and redaction summaries, not raw prompts or raw provider payloads.

## Trace Events

Trace events are structured summaries with run ID, request ID, timestamp, event type,
and JSON-safe attributes. They are intended for runtime inspection and external
observability sinks, not raw transcript storage.

Default event capture is metadata-only. Raw prompts, user text, tool outputs, provider
payloads, secrets, session tokens, cookies, and payment data are not emitted by default.

Content capture modes:

- `none`: omit content-like attributes.
- `metadata`: keep size/key summaries only.
- `redacted_content`: include redacted content after sensitive-value scrubbing.

When trace attributes include AICF security classification metadata, the optional
`ai-capability-framework/security` redaction defaults are applied before collection.
This preserves existing capture modes while adding fail-closed handling for credentials
and sensitive data classes.

## Trace Sinks

- `NoopTraceSink` discards events.
- `CollectingTraceSink` stores sanitized events in memory for tests.
- `CompositeTraceSink` fans out to multiple sinks and isolates sink failures.
- `NoopTracer`, `InMemoryTracer`, `TraceSinkTracer`, and `OpenTelemetryTracerAdapter`
  provide a run/span-style API over the same sanitized event model.
- `OpenTelemetryTraceSink` accepts a tracer-like API object and maps useful `gen_ai.*`
  attributes plus stable `aicf.*` attributes.

OpenTelemetry GenAI conventions are still evolving, so AICF keeps its own namespaced
attributes for framework-specific data such as capability ID, policy status, action
state, run ID, and request ID.

## OpenAI Runtime Integration

`runOpenAIResponses()` accepts optional `traceSink` and `contentCapture` options. It
emits events for context building, routing, model calls, tool call parsing, tool
execution, runtime errors, and completion.

Trace sink failures do not fail the runtime request. They produce safe internal
diagnostics only.

## Langfuse

Langfuse support is available from `ai-capability-framework/langfuse`. The adapter
accepts a client-like object and probes methods at runtime, so the SDK is optional and
version drift does not affect Core imports.

Langfuse dataset helpers convert AICF eval cases into public-safe dataset items and
back. They do not upload data by themselves.

`LangfuseTracerAdapter` wraps the same sink behavior with the run/span-style tracer API.
It still accepts a client-like object and does not require the Langfuse SDK.

The runtime support/billing example is intentionally no-model and no-trace by default.
Hosts can add `CollectingTraceSink` or another sink around the same runtime path when
they need sanitized runtime inspection.
