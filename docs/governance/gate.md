# Governance Gate

`aicf gate` is a CI-friendly command that runs the public AICF checks in one
deterministic pass. It coordinates validation, semantic invariants, governance
risk, lifecycle posture, optional compatibility baselines, impact analysis,
eval coverage, security-pack coverage, provider conformance, and public artifact
hygiene.

The gate does not call models, run live provider SDKs, mutate manifests, execute
handlers, write production stores, or expose commit tools to models.
It does not call live integrations; provider conformance is descriptor/mock
checking only.

## Basic Usage

```bash
npm run build
node dist/cli.js gate examples --env production
```

JSON output is useful in CI:

```bash
node dist/cli.js gate examples --env production --format json
```

Exit codes are stable:

| Code | Meaning |
| --- | --- |
| `0` | Gate passed. |
| `1` | Validation or gate check failed. |
| `2` | Usage or configuration error. |
| `3` | Reserved for missing optional dependencies. |
| `4` | Reserved for disabled live integrations or missing credentials. |
| `5` | Unexpected internal error. |

F8 does not run live integrations, so codes `3` and `4` are reserved for future
optional paths or errors surfaced by existing optional helpers.

## Configuration

The gate looks for config in this order:

1. `--config <file>`
2. `<manifest-root>/aicf.config.yaml`, `.yml`, or `.json`
3. `./aicf.config.yaml`, `.yml`, or `.json`
4. safe defaults when no config exists

Example:

```yaml
schema_version: "1.0"
project:
  name: aicf-public-examples
  environment: production
providers:
  enabled:
    - openai
    - anthropic
    - mcp
  server_url: https://aicf.example.com
gates:
  production:
    fail_on_warnings: false
    require_evals_for: [medium, high, critical]
    require_security_packs_for: [high, critical]
    require_conformance_for_enabled_providers: true
    block_deprecated_capabilities: true
    artifact_hygiene: true
```

Enabled providers are descriptor/mock conformance targets. Provider aliases use
the same normalization as provider conformance, for example `vercel-ai-sdk` maps
to `ai-sdk` and `semantic-kernel` maps to `semantic-kernel-openapi`.

## Production Defaults

When no config exists, the production gate uses conservative defaults:

- warnings do not fail the gate unless `--fail-on-warnings` is supplied;
- medium, high, and critical capabilities require eval coverage;
- high and critical capabilities require assigned, generated, or waived
  security-pack coverage;
- configured providers must pass conformance;
- deprecated capabilities are blocked;
- public artifact hygiene is enabled.

Compatibility checks run only when `--baseline <path>` or
`compatibility.baseline_root` is provided.

## CLI Options

```bash
aicf gate <manifest-root> --env <name> \
  [--config <file>] \
  [--baseline <path>] \
  [--format text|json] \
  [--json] \
  [--fail-on-warnings] \
  [--no-artifact-hygiene]
```

Use `--no-artifact-hygiene` only for narrow local debugging. Release checks
should keep artifact hygiene enabled so private paths, traces, prompts, raw
provider payloads, archives, Office/PDF artifacts, credential-looking files, and
local-only material are rejected.

## TypeScript

```ts
import {
  loadGovernanceGateConfig,
  runGovernanceGate,
  formatGovernanceGateReport
} from "ai-capability-framework/governance";

const report = await runGovernanceGate({
  manifestRoot: "examples",
  environment: "production"
});

console.log(formatGovernanceGateReport(report, "text"));
```

The report is JSON-serializable and schema-valid against
`schemas/governance/gate-report.schema.json`.

Gate JSON can be supplied to evidence export:

```bash
node dist/cli.js gate examples --env production --format json > gate-report.json
node dist/cli.js evidence export examples --out evidence-pack.json --gate-report gate-report.json
```

The evidence pack records gate, eval, security, and conformance gaps explicitly
when reports are not supplied.
