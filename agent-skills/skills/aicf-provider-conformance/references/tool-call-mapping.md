# Tool Call Mapping

- Generate provider-safe names deterministically.
- Preserve provider call IDs when available.
- Resolve provider tool names through the binding map.
- Reject unknown names and calls outside the routed slice.
- Validate args against the original AICF input schema.
- Return model-safe envelopes for validation errors and denials.
