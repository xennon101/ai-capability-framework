# Google Gemini

The Gemini provider subpath exposes routed AICF read/prepare capabilities as Gemini
function declarations and can run a bounded mock-tested GenerateContent loop with a
caller-provided client.

Read:

- [Google Gemini runtime](../gemini-runtime.md)

Default tests use mock clients. Live Gemini tests are opt-in and require explicit
environment variables.
