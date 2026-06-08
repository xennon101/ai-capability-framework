# Trace Span Map

Recommended trace events:

- runtime start and end.
- context build.
- capability route.
- provider call.
- tool call parse.
- tool execution.
- policy decision.
- action prepare, approval, commit, verify.
- eval scoring.
- runtime error.

Use stable AICF attributes and provider attributes only when the event supplies provider
metadata.
