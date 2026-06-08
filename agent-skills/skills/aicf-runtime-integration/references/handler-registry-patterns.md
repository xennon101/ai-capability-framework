# Handler Registry Patterns

- Register one handler per capability ID.
- Reject duplicate handler IDs.
- Validate handler input against AICF schemas before calling app services.
- Validate handler output before returning a tool envelope.
- Keep handler side effects behind lifecycle and policy checks.
- Return safe unavailable or failed envelopes when a handler is missing or throws.
