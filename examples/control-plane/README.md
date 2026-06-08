# AICF Control Plane Example

This is a public-safe local reference app for the optional AICF control-plane
subpath. It shows capability review, governance status, eval/security coverage,
policy decisions, approvals, controls, replay metadata, and evidence export
without credentials.

The example uses:

- validated manifests from `examples/`;
- synthetic seed state from `examples/control-plane/fixtures/`;
- mutable local state in `.aicf/control-plane-state.json`;
- a fake local development user.

Production deployments must enforce real authentication, tenant/account
authorization, approval identity, durable storage, audit retention, and side
effects outside this example.

## Run

```bash
npm run build
node examples/control-plane/server.mjs
```

Open `http://localhost:4127`.

Set a different port with:

```bash
PORT=4300 node examples/control-plane/server.mjs
```

## What It Shows

- capability catalogue and detail;
- lifecycle/risk posture;
- eval, security-pack, and provider-conformance summaries;
- redacted policy decision, action, and approval records;
- kill switches, budgets, and circuit breaker state;
- redacted replay index;
- evidence export with refs, hashes, and summaries only.

The app never displays raw prompts, provider payloads, transcripts, secrets,
stack traces, tenant IDs, account IDs, or sensitive tool outputs.
