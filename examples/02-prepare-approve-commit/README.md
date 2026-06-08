# 02 Prepare, Approve, Commit

Fake data: synthetic support tickets, orders, refund previews, and host
approval records in `examples/runtime-support-billing/`.

Goal: run the no-model runtime flow: route, read, prepare, approval required,
host approval, and lifecycle commit.

Command:

```bash
node examples/runtime-support-billing/run-mock.mjs
```

Expected output:

```text
approval_required
committed
```

No secrets are required. No live provider calls run by default. Commit is never
exposed as a model tool; the host lifecycle manager owns commit.
