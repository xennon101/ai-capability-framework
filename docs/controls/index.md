# Runtime Controls

AICF controls let a host application narrow or stop capability use without
changing manifests. They are optional runtime inputs, not a production control
plane or model gateway.

Controls can apply to a global runtime, provider, model, capability, domain,
risk tier, tenant, or autonomy tier. AICF evaluates them before capability
routing, tool export, model tool execution, lifecycle commit, and supported
provider runtime calls.

## Kill Switches

Kill switches are the fastest control:

- `deny` blocks matching capability export and execution.
- `force_approval` keeps read and prepare paths available, but forces host
  approval before lifecycle commit.
- `read_only` keeps read/select paths available and blocks prepare, commit,
  write, send, money-movement, and destructive capabilities.

Example:

```json
{
  "id": "ks_refund_review",
  "scope": { "type": "capability", "capabilityId": "support.refund.prepare_case" },
  "mode": "force_approval",
  "reason": "Refund review is active.",
  "createdAt": "2026-06-04T00:00:00.000Z"
}
```

## Circuit Breakers

Circuit breakers evaluate recent runtime signals such as provider error rate,
validation failure rate, approval rejection rate, tool-loop limit hits, and
budget failures. F4 includes deterministic evaluation and in-memory/reference
state only. Production metrics ingestion and durable storage remain host
responsibilities.

## Budgets

Budgets limit one run. Defaults apply when controls are configured:

- 8 tool calls per run
- 8 provider calls per run
- 60 seconds runtime per run
- 2 retries per run

Token and estimated-cost budgets are optional fields. Hard budgets fail closed;
warn budgets return warnings without blocking.

## CLI

Local CLI state uses `.aicf/controls.json`, which is ignored and must not be
tracked.

```bash
aicf controls list --format json
aicf controls check examples --capability support.refund.prepare_case --provider openai
aicf controls kill-switch create --capability support.refund.prepare_case --mode force_approval --reason "incident review"
```

The CLI is useful for local review and demos. Host applications should provide
their own authenticated control store for production.
