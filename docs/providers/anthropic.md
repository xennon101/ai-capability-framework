# Anthropic Claude

The Anthropic provider subpath exposes routed AICF read/prepare capabilities as
Claude Messages tools and can run a bounded mock-tested tool-use loop with a
caller-provided client.

Read:

- [Anthropic Claude runtime](../anthropic-runtime.md)

Default tests use mock clients. Live Claude tests are opt-in and require
explicit environment variables.
