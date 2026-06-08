# Impact And Compatibility

Compatibility checks compare two capability manifests and classify changes as
compatible, minor, or breaking. Impact analysis reports direct registry
coverage across entities, evals, prepare/commit links, policy references, and
provider export relevance.

Use:

```bash
node dist/cli.js governance impact examples --capability support.refund.prepare_case
node dist/cli.js governance compatibility --before old.yaml --after new.yaml
```

Compatibility baselines are opt-in for the governance gate.
