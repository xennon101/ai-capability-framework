# Start Here

This guide shows the smallest useful AICF path with the public support/refund
example. It is API-key-free and uses synthetic data only.

You will validate manifests, inspect the registry, export OpenAI tools, run the
mock runtime flow, and score evals.

## 1. Install

```bash
npm install
```

This installs the local package dependencies. It does not install provider SDKs
or call any model.

## 2. Validate The Public Examples

```bash
npm run validate
```

Expected excerpt:

```text
Validated 16 manifest(s) and 13 fixture(s).
```

This proves the public manifests and fixture files are parseable, schema-valid,
cross-referenced, and public-safe enough for the validation rules.

## 3. Inspect The Registry

Build the CLI, then inspect the examples:

```bash
npm run build
node dist/cli.js inspect examples
```

Expected excerpt:

```text
AICF Registry
Manifests: 16
Capabilities by type:
- read_data: scheduling.availability.get, support.ticket.get
- write_prepare_only: scheduling.invite.prepare, support.refund.prepare_case
- write_commit: scheduling.invite.send, support.refund.commit_case
```

This shows the validated registry AICF uses for routing, provider export,
policy decisions, and eval scoring.

## 4. Export OpenAI Tools

```bash
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
```

Expected excerpt:

```json
{
  "tools": [
    {
      "type": "function",
      "name": "aicf_support_refund_prepare_case",
      "strict": true
    },
    {
      "type": "function",
      "name": "aicf_support_ticket_get",
      "strict": true
    }
  ],
  "excluded": [
    {
      "capabilityId": "support.refund.commit_case"
    }
  ]
}
```

This proves safe tool export. The model can see read and prepare tools, but the
commit capability is not exposed as a normal model tool.

## 5. Run The Mock Runtime Flow

```bash
node examples/runtime-support-billing/run-mock.mjs
```

Expected excerpt:

```json
{
  "readStatus": "success",
  "prepareStatus": "approval_required",
  "commitStatus": "committed"
}
```

This runs route, read, prepare, approval, and lifecycle commit with mock
handlers and in-memory reference stores. The model-facing path still cannot
commit. Commit happens only after the host records approval and calls the
lifecycle manager.

## 6. Run Deterministic Evals

```bash
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

Expected excerpt:

```text
Eval suite passed: 6/6 passed.
```

This proves the candidate fixture matches the eval manifests for tool
selection, arguments, policy decisions, refusals, response text, and no
unapproved commit boundaries.

## What You Just Proved

- Public manifests validate and build a registry.
- OpenAI tool export is safe and does not expose commit tools by default.
- Provider SDK validation does not replace AICF validation.
- The runtime can execute read and prepare handlers with model-safe envelopes.
- Approval-required prepare pauses before side effects.
- Host-controlled lifecycle commit works after approval and idempotency checks.
- Evals score behavior without calling models.

Next, read the [OpenAI walkthrough](openai-walkthrough.md) for the same flow
from the model/tool-call perspective, then use the [glossary](glossary.md) for
the main terms.
