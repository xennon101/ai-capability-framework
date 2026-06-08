# Tool Result Envelope

AICF tool result envelopes are JSON-serializable results that can be safely returned to
a model or host.

Common statuses include success, denied, approval required, unavailable, validation
error, failed, and verified. Model-facing helpers strip private diagnostics before
output crosses a model boundary.

Relevant references:

- [API reference](../api.md)
- [Runtime contracts](../runtime.md)
- `schemas/tool-result-envelope.schema.json`

Handlers should return structured data. They should not expose secrets, stack traces,
raw provider payloads, or private diagnostics in model-facing output.
