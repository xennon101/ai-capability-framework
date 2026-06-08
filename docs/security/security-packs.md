# Capability-Aware Security Packs

Security packs are public-safe test templates for common AI capability risks. They help
teams generate deterministic eval cases and Promptfoo red-team configs from the
capabilities already described in AICF manifests.

Security packs are implementation aids only. They are not certification, compliance
attestation, legal advice, an audit opinion, or a security guarantee. Host applications
own real red-team execution, evidence retention, policy review, incident response, and
production controls.

## What They Cover

The built-in catalog includes packs for:

- direct and indirect prompt injection
- tool exfiltration
- cross-tenant access
- approval bypass
- unsafe commit attempts
- schema confusion
- capability spoofing
- tool-result poisoning
- sensitive data disclosure
- insecure output rendering
- cost amplification
- provider payload exposure
- MCP tool abuse
- retrieval poisoning
- memory scope violation

The catalog lives in public YAML files under `security-packs/`. The TypeScript API
exposes the same catalog from:

```ts
import {
  assessSecurityPackCoverage,
  generateSecurityCases,
  listSecurityPacks
} from "ai-capability-framework/security-packs";
```

## Capability Metadata

F6 does not add a new top-level manifest field. Assign packs through
`extensions.governance.security_packs`:

```yaml
extensions:
  governance:
    security_packs:
      - approval_bypass
      - unsafe_commit_attempt
```

Waivers are explicit and reviewable:

```yaml
extensions:
  governance:
    security_pack_waivers:
      - pack_id: cross_tenant_access
        reason: "Capability has no tenant-scoped data path."
        reviewer: "security@example.com"
        reviewed_at: "2026-06-04T00:00:00.000Z"
```

Waivers must include `pack_id`, `reason`, `reviewer`, and `reviewed_at`.

## Coverage Rules

`assessSecurityPackCoverage()` recommends packs from manifest metadata:

- high and critical risk capabilities require assigned/generated packs or a waiver;
- money movement, commit, irreversible, external-message, workflow, permission-changing,
  tenant-scoped, retrieval, memory, MCP, and provider-exposed capabilities receive
  additional recommendations;
- missing required packs are reported as coverage failures.

The coverage report is deterministic and local. It does not inspect raw traces, call
providers, or infer production security posture.

## Generate Cases

Generate public-safe security cases for one pack:

```bash
aicf security generate examples \
  --pack approval_bypass \
  --out ./security-cases.approval-bypass.yaml
```

The output is a synthetic case suite. Case text uses public capability IDs and generic
prompts only; it does not include raw prompts, provider payloads, credentials, customer
records, or private diagnostics.

TypeScript:

```ts
const suite = generateSecurityCases(registry, {
  packIds: ["approval_bypass"]
});
```

Generated cases can be reviewed and converted into ordinary AICF eval manifests or used
as host-owned test inputs.

## Promptfoo Export

Security-pack Promptfoo export lives in this subpath, separate from the generic
`ai-capability-framework/promptfoo` helpers:

```bash
aicf security export-promptfoo examples \
  --out ./promptfooconfig.aicf-security.yaml
```

The generated YAML defaults to the API-key-free `echo` provider and includes a
placeholder target endpoint. Replace the provider and target in a host-owned test
environment before running Promptfoo.

The export includes assertions for:

- no forbidden commit/tool calls;
- approval-required behavior where relevant;
- no model-exposed commit;
- no private diagnostics, raw prompts, provider payloads, secrets, or tokens in
  model-facing output.

AICF does not run Promptfoo and does not require Promptfoo as a dependency.

## CLI

```bash
aicf security list-packs
aicf security list-packs --format json
aicf security generate examples --pack approval_bypass --out ./cases.yaml
aicf security generate examples --pack approval_bypass --out ./cases.json --format json
aicf security export-promptfoo examples --out ./promptfooconfig.aicf-security.yaml
```

Commands validate manifests first. Unknown pack IDs, invalid manifests, missing output
paths, and empty generated suites exit nonzero.
