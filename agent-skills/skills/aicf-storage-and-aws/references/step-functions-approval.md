# Step Functions Approval

Step Functions approval adapters should:

- start executions with safe prepared-action summaries.
- correlate task tokens with redacted approval refs.
- send success for approved decisions and failure for rejected decisions.
- handle expiry and cancellation safely.
- avoid storing raw args or sensitive results.
- leave approval identity and UI to the host application.
