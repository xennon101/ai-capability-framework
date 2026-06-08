# Risk Compiler

The risk compiler compares declared risk to inferred minimum risk from side
effects, lifecycle, policy, idempotency, audit, auth scoping, and entity
metadata.

Use:

```bash
node dist/cli.js governance risk examples --format text
```

Safety and runtime correctness issues are errors. Quality or migration gaps are
warnings unless they affect safety.
