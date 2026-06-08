# Lifecycle

Lifecycle checks decide whether a capability can move between governance statuses such
as draft, review, approved, canary, production, deprecated, disabled, and removed.

Use:

```bash
node dist/cli.js governance lifecycle examples --capability support.refund.prepare_case --to production
```

Lifecycle decisions are structured recommendations. AICF does not mutate manifests or
deploy capabilities.
