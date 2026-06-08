# EvalOps Export Interfaces

AICF EvalOps helpers convert public-safe AICF eval cases and summarized results into
formats that host applications can send to external eval systems.

Import from:

```ts
import {
  exportBraintrustDataset,
  exportOpenAIEvalDataset,
  importBraintrustResults,
  importOpenAIEvalResults
} from "ai-capability-framework/evalops";
```

The EvalOps subpath does not call Braintrust, OpenAI, Promptfoo, or any model provider.
It does not require provider SDKs and does not upload data.

## What Is Exported

Exports include eval IDs, user-message fixtures, expected summaries, scorer names, tags,
and capability-under-test metadata. Raw prompts, raw provider payloads, traces, secrets,
tokens, private diagnostics, account IDs, tenant IDs, and customer data are not
included.

## Promptfoo

Promptfoo support remains in `ai-capability-framework/promptfoo`.
`exportPromptfooSuite()` generates files only. It includes an API-key-free echo provider
by default plus README guidance for replacing provider placeholders in a host-owned test
environment.

## Host Responsibilities

Host applications own external service accounts, credentials, dataset retention, eval
execution, dashboards, alerting, and review workflows.
