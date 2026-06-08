# Capability Manifests

Capability manifests are the core AICF contract. They describe the operation,
input and output schemas, lifecycle, permissions, risk, policy, and eval
coverage.

Use the existing guide for the full field reference:

- [Capability manifests](../capability-manifests.md)
- [Spec](../spec.md)

Try the support examples:

```bash
node dist/cli.js inspect examples
node dist/cli.js validate examples
```

The examples are synthetic and use fake support tickets, orders, and scheduling
data only.
