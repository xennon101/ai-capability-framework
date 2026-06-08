# Control Plane

The AICF control plane is an optional self-hostable review surface for
capabilities and their runtime evidence. It is for local or host-owned
governance workflows, not a hosted SaaS dashboard.

The control plane does not call models, run provider SDKs, execute handlers,
commit side effects, enforce production auth, or provide durable production
storage. Host applications must supply real authentication, tenant/account
authorization, approval identity, storage, retention, and side-effect
execution.

## What It Reviews

The control plane composes existing AICF evidence:

- capability catalogue and detail;
- lifecycle, risk, compatibility, and impact analysis;
- eval coverage and security-pack coverage;
- provider conformance summaries;
- policy decision ledger records;
- action and approval records;
- kill switches, budgets, and circuit breaker state;
- redacted replay metadata;
- evidence exports made only from summaries, hashes, and redacted refs.

It must not display raw prompts, raw provider payloads, raw transcripts,
secrets, stack traces, tenant IDs, account IDs, or sensitive tool outputs.
The evidence endpoint preserves the control-plane response shape and also
includes the canonical evidence pack documented in [Evidence export](evidence.md).

## TypeScript

```ts
import {
  createControlPlaneService,
  InMemoryControlPlaneStore,
  routeControlPlaneRequest
} from "ai-capability-framework/control-plane";
import { buildRegistry, loadManifests } from "ai-capability-framework";

const loaded = await loadManifests({ path: "examples" });
const registry = buildRegistry(loaded.manifests);

const service = createControlPlaneService({
  registry,
  store: new InMemoryControlPlaneStore()
});

const response = await routeControlPlaneRequest({
  service,
  request: {
    method: "GET",
    path: "/api/aicf/capabilities"
  }
});
```

`routeControlPlaneRequest()` returns a JSON-serializable response with
`status`, `headers`, and `body`. It does not start a server. Bind it to Express,
Fastify, a Node HTTP server, a worker, or another host-owned transport.

## Local Reference App

Run the credential-free example:

```bash
npm run build
node examples/control-plane/server.mjs
```

Then open `http://localhost:4127`.

The example uses a tracked synthetic seed fixture and writes local mutable state
to `.aicf/control-plane-state.json`, which is ignored. It uses a fake local dev
operator only to demonstrate approve/reject and kill-switch interactions.

## API Paths

The reference router supports:

- `GET /api/aicf/capabilities`
- `GET /api/aicf/capabilities/:id`
- `GET /api/aicf/capabilities/:id/impact`
- `POST /api/aicf/capabilities/:id/lifecycle/evaluate`
- `GET /api/aicf/decisions`
- `GET /api/aicf/actions`
- `GET /api/aicf/approvals`
- `POST /api/aicf/approvals/:id/approve`
- `POST /api/aicf/approvals/:id/reject`
- `GET /api/aicf/controls/kill-switches`
- `POST /api/aicf/controls/kill-switches`
- `DELETE /api/aicf/controls/kill-switches/:id`
- `GET /api/aicf/evals/status`
- `GET /api/aicf/conformance/status`
- `POST /api/aicf/evidence/export`

Errors use a stable safe shape:

```json
{
  "error": {
    "code": "control_plane_not_found",
    "message": "Capability \"example.missing\" was not found."
  }
}
```

Stack traces and private diagnostics are not returned.

## Stores

`InMemoryControlPlaneStore` is for tests and examples.

`FileControlPlaneStore` is for local development. It defaults to
`.aicf/control-plane-state.json` and should not be used as production durable
storage.

Production hosts can wire `DynamoDbControlPlaneStore` from
`ai-capability-framework/aws` to the same service/router API when they want AWS
backed audit, controls, approval, and replay metadata. The AWS adapter remains
optional and does not provide production auth, deployment, tenant enforcement,
or evidence retention policy.

Production hosts should implement `AicfControlPlaneStore` with their own
authorization, audit, retention, and tenant isolation.
