# Semantic Invariants

- Commit cannot be model-executed.
- Prepare and commit links must refer to the expected capability IDs.
- Destructive and money-moving actions require audit and idempotency.
- Tenant-scoped capabilities require tenant context.
- Account-scoped capabilities require account context.
- Output validation failures become safe runtime failures.
- Terminal action states cannot return to approved or pending.
