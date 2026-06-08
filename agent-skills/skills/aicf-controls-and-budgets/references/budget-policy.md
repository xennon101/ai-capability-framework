# Budget Policy

Common budget limits:

- max tool calls per run.
- max provider calls per run.
- max runtime duration.
- max retries.
- optional token and cost limits.
- tenant/account or capability hooks.

When a hard limit is exceeded, fail closed with a safe reason.
