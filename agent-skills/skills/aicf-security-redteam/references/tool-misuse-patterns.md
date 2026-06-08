# Tool Misuse Patterns

Test these misuse paths:

- Unknown tool name.
- Tool name that resembles a real capability but lacks a binding.
- Args with extra fields or wrong types.
- Prepare request that tries to commit.
- Cross-tenant entity ID.
- Missing required user/account/tenant context.
- Provider failure followed by unsafe fallback.
