# Runtime Overview

AICF Runtime is the no-model execution layer for host applications that want
deterministic routing, policy brokering, read/prepare handlers, prepared
actions, approvals, idempotency, and model-safe envelopes.

Start with the canonical runtime guide:

- [Runtime contracts](../runtime.md)
- [OpenAI walkthrough](../openai-walkthrough.md)

Boundary: the runtime does not call models or expose commit tools to models.
Host applications own auth, data access, storage, approval UI, and side
effects.
