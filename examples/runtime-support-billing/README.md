# Runtime Support Billing Example

This public-safe example shows the AICF runtime path with synthetic support and refund
capabilities.

It uses the existing manifests under `examples/support/`, mock handlers, in-memory
reference stores, and deterministic runtime context. It does not call models, call
providers, use real billing systems, store traces, or include customer data.

Run it from the repository after building:

```bash
npm run build
node examples/runtime-support-billing/run-mock.mjs
```

The mock flow demonstrates:

- loading and validating public support manifests;
- routing model-safe read and prepare capabilities;
- executing a read handler through `AicfToolExecutor`;
- preparing a refund case that requires approval;
- recording a host approval;
- committing only through `AicfActionLifecycleManager` with idempotency.

Commit capability metadata remains in the registry, but commit is not exposed in the
model-facing capability slice. The commit step is a host-controlled runtime call after a
stored prepared action and approval decision exist.
