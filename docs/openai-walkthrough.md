# OpenAI Walkthrough

This walkthrough uses the public support/refund example to show how AICF works
with OpenAI. The default path is API-key-free: it exports tools, shows the tool
call and repair shapes, and uses the mock runtime example. Live OpenAI usage is
optional and requires a caller-provided client.

## The Scenario

The user asks:

```text
Check ticket TCK-1001 and prepare a refund case if the customer is eligible.
```

The support example has three relevant capabilities:

- `support.ticket.get`: read a ticket.
- `support.refund.prepare_case`: prepare a refund case for approval.
- `support.refund.commit_case`: commit the refund after host approval.

The first two can be model-facing tools. The commit capability is host
controlled and is not exposed to the model by default.

## 1. Capability Manifests Define The Contract

A capability manifest describes the model-facing purpose, the input and output
schemas, the risk tier, required permissions, policy gates, lifecycle flags, and
eval links.

Small excerpt:

```yaml
id: support.refund.prepare_case
capability_type: write_prepare_only
risk_tier: medium
lifecycle:
  prepare: true
  commit: false
policy:
  approval_required: true
```

AICF validates these manifests before any provider tool export or runtime
execution.

## 2. AICF Exports OpenAI Function Tools

```bash
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
```

Small excerpt:

```json
{
  "tools": [
    {
      "type": "function",
      "name": "aicf_support_ticket_get",
      "description": "Read support ticket details...",
      "strict": true
    },
    {
      "type": "function",
      "name": "aicf_support_refund_prepare_case",
      "description": "Prepare a refund case...",
      "strict": true
    }
  ],
  "bindings": [
    {
      "toolName": "aicf_support_ticket_get",
      "capabilityId": "support.ticket.get"
    }
  ]
}
```

The binding map is important. AICF never guesses a capability ID from a provider
tool name; it maps tool calls back through generated bindings.

## 3. OpenAI Returns A Function Call

A model might return a Responses function call like this:

```json
{
  "type": "function_call",
  "call_id": "call_ticket_1",
  "name": "aicf_support_ticket_get",
  "arguments": "{\"ticket_id\":\"TCK-1001\"}"
}
```

AICF parses the provider call, resolves the binding to `support.ticket.get`,
parses JSON arguments, and validates those arguments against the original AICF
`input_schema`.

## 4. Invalid Calls Become Repair Envelopes

If the model calls an unknown tool or sends incorrect arguments, AICF fails
closed. The app can return a model-safe repair envelope as the tool output.

Example validation failure:

```json
{
  "status": "validation_error",
  "capability_id": "support.ticket.get",
  "message": "Tool arguments failed AICF validation.",
  "details": [
    {
      "path": "/ticket_id",
      "message": "must be string"
    }
  ]
}
```

OpenAI continuation shape:

```json
{
  "type": "function_call_output",
  "call_id": "call_ticket_1",
  "output": "{\"status\":\"validation_error\",\"message\":\"Tool arguments failed AICF validation.\"}"
}
```

The model can then repair its next call. The app may also decide to stop, ask
the user for clarification, or escalate to a stronger model. AICF only provides
the safe envelope and deterministic validation result.

## 5. Prepare Can Require Approval

For a refund above the approval threshold, prepare returns an approval-required
envelope:

```json
{
  "status": "approval_required",
  "capability_id": "support.refund.prepare_case",
  "prepared_action": {
    "prepared_action_id": "prepared_support_refund_1001",
    "summary": "Refund case prepared for host approval."
  },
  "message": "Approval is required before commit."
}
```

This tells the model that work has paused. It must not claim the refund was
issued.

## 6. Commit Is Host-Controlled

The model does not call `support.refund.commit_case`. The host application owns:

- showing approval UI;
- recording approval or rejection;
- verifying user, account, tenant, and policy state;
- reserving idempotency;
- committing the side effect through the lifecycle manager;
- writing durable audit records.

In the mock example:

```bash
node examples/runtime-support-billing/run-mock.mjs
```

Expected excerpt:

```json
{
  "prepareStatus": "approval_required",
  "commitStatus": "committed"
}
```

## 7. Optional Live OpenAI Runtime

The optional `ai-capability-framework/openai` subpath can run a bounded
non-streaming Responses loop with a caller-provided compatible client:

```ts
import { runOpenAIResponses } from "ai-capability-framework/openai";
```

AICF does not require the OpenAI SDK for root or runtime imports. Live usage is
opt-in, and host applications remain responsible for provider credentials,
model selection, auth, side effects, approvals, storage, and audit.

## What To Read Next

- [Start here](start-here.md) for the full command sequence.
- [OpenAI runtime](openai-runtime.md) for the live runtime API.
- [Runtime contracts](runtime.md) for handlers, policy, lifecycle, and envelopes.
- [Eval runner](eval-runner.md) for proving behavior without model calls.
