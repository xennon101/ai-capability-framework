# Lifecycle State Machine

Allowed lifecycle states:

- `draft`: early design, not ready for model exposure.
- `review`: ready for structured review.
- `approved`: accepted for controlled rollout.
- `canary`: limited exposure with monitoring.
- `production`: generally available under configured policy.
- `deprecated`: still present but replacement is expected.
- `disabled`: blocked from routing/execution.
- `removed`: terminal state for retired contracts.

Promotion should require owner, validation, eval/security coverage, risk controls, and
no active kill switch.
