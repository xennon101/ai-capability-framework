# Action State Machine

Typical states:

- proposed
- prepared
- approval required
- approved
- rejected
- committing
- committed
- failed
- expired
- cancelled

Terminal states such as committed, failed, expired, cancelled, and rejected must not
move back to approved or pending.
