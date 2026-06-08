# AICF Governance

AICF governance is a pure contract and analysis layer. It helps maintainers review
capability lifecycle changes, infer minimum risk, compare versions, and understand what
else a capability touches before it is exposed to AI systems.

Governance APIs do not call models, execute handlers, mutate manifests, write stores, or
replace your policy engine. They return structured decisions that a host app, CI job, or
release process can act on.

Runtime controls are separate from governance analysis. Governance can report active
kill switches or circuit breakers as promotion blockers; the optional
`ai-capability-framework/controls` subpath evaluates those controls at runtime.

Governed memory is also separate. The optional `ai-capability-framework/memory` subpath
checks host-owned memory summaries for use-case, scope, expiry, consent, and sensitivity
before they become model context. It does not store or recall memory.

Capability-aware security packs are also separate runtime/test artifacts, but their
assignment metadata lives under `extensions.governance.security_packs`. Explicit waivers
live under `extensions.governance.security_pack_waivers` and must include `pack_id`,
`reason`, `reviewer`, and `reviewed_at`. See
[security packs](../security/security-packs.md).

## Governance Gate

`aicf gate` runs the release-oriented checks together: manifest and fixture validation,
semantic invariants, risk, lifecycle posture, optional compatibility baseline checks,
impact analysis, eval coverage, security-pack coverage, configured provider conformance,
and public artifact hygiene.

```bash
aicf gate examples --env production --format json
```

See [governance gate](gate.md) for config, defaults, and CI exit codes.

## Control Plane

`ai-capability-framework/control-plane` provides an optional self-hostable API and local
reference UI for reviewing governance outputs, policy decision records, action/approval
queues, runtime controls, eval/security/conformance status, and redacted replay
metadata.

The control plane is not a hosted service and does not provide production auth, durable
storage, workflow orchestration, model calls, provider SDK execution, or side-effect
execution. See [control plane](../control-plane.md).

## Lifecycle

Governance lifecycle status is separate from the current manifest `status` field. When a
command needs a starting status and `--from` is not supplied, AICF maps current manifest
status like this:

| Manifest status | Governance status |
| --------------- | ----------------- |
| `draft`         | `draft`           |
| `experimental`  | `review`          |
| `active`        | `production`      |
| `deprecated`    | `deprecated`      |
| `disabled`      | `disabled`        |

Supported governance statuses are `draft`, `review`, `approved`, `canary`, `production`,
`deprecated`, `disabled`, and `removed`.

Example:

```bash
aicf governance lifecycle examples \
  --capability support.refund.prepare_case \
  --from review \
  --to approved \
  --reason "Ready for controlled review"
```

The result includes `allowed`, blocking reasons, warnings, and required actions. No
files are changed.

## Risk Compilation

Risk compilation compares the declared `risk_tier` with an inferred minimum risk from
side effects, lifecycle metadata, auth scope, entity classifications, and policy
controls.

```bash
aicf governance risk examples --capability support.refund.prepare_case
```

Missing safety controls are blocking. Catalogue-quality gaps, such as missing usage
guidance, remain warnings unless `--strict` is used.

## Compatibility

Compatibility compares two versions of a capability manifest and classifies the change
as `compatible`, `requires_minor`, or `breaking`.

```bash
aicf governance compatibility \
  --before old/support.refund.prepare_case.yaml \
  --after examples/support/capabilities/support.refund.prepare_case.yaml
```

Breaking changes include adding required input fields, removing inputs, lowering risk,
lowering approval requirements, adding side effects, or removing idempotency/audit
controls.

## Impact

Impact analysis reports directly affected capabilities, entities, evals, provider
exports, policy references, and coverage gaps from the loaded registry.

```bash
aicf governance impact examples --capability support.refund.prepare_case
```

F1 impact analysis is registry-local. Trace, tenant, or production-store impact can be
supplied by later host integrations, but no database is required.

## TypeScript

```ts
import {
  analyzeCapabilityImpact,
  compareCapabilityVersions,
  compileCapabilityRisk,
  evaluateLifecycleTransition,
  formatGovernanceGateReport,
  loadGovernanceGateConfig,
  runGovernanceGate
} from "ai-capability-framework/governance";
```

All functions are deterministic and return JSON-serializable results.
