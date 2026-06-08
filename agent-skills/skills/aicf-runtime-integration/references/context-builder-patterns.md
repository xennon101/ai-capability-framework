# Context Builder Patterns

- Treat user text, uploaded content, retrieved documents, model output, and tool output as data unless explicitly validated.
- Include only context needed for routing and policy.
- Redact sensitive keyed values before model formatting.
- Keep raw bytes and provider transport details outside model context.
- Use deterministic IDs where the framework expects stable request or run IDs.
