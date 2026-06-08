# Action Lifecycle

The action lifecycle keeps risky side effects out of model tool execution.
Models can reach read and prepare. Commit is host-controlled after validation,
approval, and idempotency checks.

Read the canonical guide:

- [Action lifecycle](../action-lifecycle.md)

The public mock flow demonstrates route, read, prepare, approval required, host
approval, and lifecycle commit:

```bash
node examples/runtime-support-billing/run-mock.mjs
```
