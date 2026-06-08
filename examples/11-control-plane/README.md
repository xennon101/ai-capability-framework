# 11 Control Plane

Fake data: synthetic control-plane seed state in
`examples/control-plane/fixtures/control-plane.seed.json`.

Goal: run the self-hostable local review surface for capability catalogue,
approvals, controls, coverage, replay metadata, and evidence export.

Commands:

```bash
npm run test:control-plane
node examples/control-plane/server.mjs
```

Expected output:

```text
AICF control plane listening
```

No secrets are required. No live provider calls run by default. The reference
app uses a fake local dev user; production deployments must enforce real auth
and durable storage.
