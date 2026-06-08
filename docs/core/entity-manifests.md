# Entity Manifests

Entity manifests describe application objects that capabilities can read, prepare, or
commit against. They help AICF explain impact, governance coverage, and allowed actions
without exposing raw databases or broad application APIs.

Public examples:

- `examples/support/entities/Ticket.yaml`
- `examples/support/entities/Order.yaml`
- `examples/scheduling/entities/AvailabilitySlot.yaml`
- `examples/scheduling/entities/MeetingInvite.yaml`

Validate them with:

```bash
node dist/cli.js validate examples
```

Entity docs stay intentionally small. Capability manifests own the callable schemas and
lifecycle rules.
