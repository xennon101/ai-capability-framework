# Provider-Neutral Quickstart

Use this path first if you want to understand AICF without choosing a model provider. It
uses the public support/refund examples and does not require API keys, provider SDKs,
live calls, or credentials.

## What You Will Prove

- Capability manifests can describe app functionality without provider-specific schemas.
- AICF can validate the registry and inspect the capability set.
- Deterministic decisions and evals run without calling a model.
- Provider adapters are optional layers over the same AICF contracts.

## 1. Install And Build

```bash
npm ci
npm run build
```

Expected output excerpt:

```text
added ... packages
tsc -p tsconfig.json
```

## 2. Inspect A Capability Manifest

Open `examples/support/capabilities/support.ticket.get.yaml`. It defines a read-only
support ticket capability with input/output schemas, permissions, risk, status, and
lifecycle metadata.

The important point is that the manifest is provider-neutral. It is not an OpenAI,
Anthropic, Gemini, MCP, LangChain, or AI SDK schema.

## 3. Validate Public Examples

```bash
npm run validate
```

Expected output excerpt:

```text
Validated 16 manifest(s) and 18 fixture(s).
```

## 4. Inspect The Registry

```bash
node dist/cli.js inspect examples
```

Expected output excerpt:

```text
Capabilities:
- support.ticket.get
- support.refund.prepare_case
- support.refund.commit_case
```

## 5. Run A Deterministic Decision

```bash
node dist/cli.js decide examples --request examples/support/decisions/support.ticket.get.select.json
```

Expected output excerpt:

```text
allowed: true
capability: support.ticket.get
```

This proves the policy/selection path without a model. The request uses a synthetic
user, tenant, permissions, and arguments.

## 6. Run Deterministic Evals

```bash
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

Expected output excerpt:

```text
Eval suite passed
```

The eval runner checks expected selected capabilities, tool calls, arguments,
approval-required behavior, and no-commit boundaries from public fixtures. It does not
call a provider.

## 7. Export Provider Descriptors Later

When you are ready to connect a provider, choose a runtime from
[Choose a Runtime](../providers/choose-a-runtime.md). The provider adapter will export a
routed AICF capability slice, but AICF validation and policy remain the authority.

Useful next steps:

- [OpenAI quickstart](openai-quickstart.md)
- [Anthropic quickstart](anthropic-quickstart.md)
- [Gemini quickstart](gemini-quickstart.md)
