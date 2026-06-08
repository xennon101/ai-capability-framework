# Verification Patterns

Verification checks whether a prepared or committed action still matches expected host
state.

Use verification for review flows, reconciliation, and post-commit checks. Verification
should return a safe envelope, never stack traces or private diagnostics.
