# AI Capability Framework

AI Capability Framework Core (AICF Core) is a provider-agnostic AI capability
framework. It helps application teams describe what an AI system is allowed to
do, expose only the right tools to a model, validate every model tool call, and
prove the behavior with deterministic evals.

AICF supports OpenAI, Anthropic Claude, Google Gemini, Vercel AI SDK, Model
Context Protocol, LangChain/LangGraph, and Semantic Kernel-compatible
MCP/OpenAPI workflows. OpenAI is one adapter, not the architecture.

## How AICF Works

```text
manifests
  -> validated registry
  -> routed capability slice
  -> provider tools
  -> runtime validation
  -> read/prepare execution
  -> approval/commit lifecycle
  -> evals
```

In plain terms:

1. You write public-safe manifests that describe capabilities, entities, and
   eval cases.
2. AICF validates those manifests and builds a registry.
3. Runtime routing picks the smallest safe slice of capabilities for a user
   request.
4. Provider adapters turn that slice into tool definitions for OpenAI or another
   provider.
5. Tool calls map back to AICF capability IDs and are validated against the
   original schema.
6. The runtime can execute host-registered read and prepare handlers.
7. Commit remains host-controlled through prepared actions, approvals,
   idempotency, and audit.
8. Eval fixtures prove selection, arguments, refusal, approval, and no-commit
   boundaries without calling a model.

## Start Here

- New to AICF: [Start here](docs/start-here.md)
- Concrete OpenAI flow: [OpenAI walkthrough](docs/openai-walkthrough.md)
- Main terms: [Glossary](docs/glossary.md)
- Full API reference: [API](docs/api.md)

## What AICF Does / What Your App Does

| AICF does | Your app does |
| --- | --- |
| Validates capability, entity, eval, context, decision, and result contracts. | Owns production auth, account state, entitlements, and tenant boundaries. |
| Routes a small model-facing capability slice. | Decides which user request and host context to pass into AICF. |
| Exports provider tool definitions and binding maps. | Calls OpenAI or another provider with a caller-provided client. |
| Parses provider tool calls back to capability IDs. | Provides real data access and business logic handlers. |
| Validates tool arguments with AICF schemas before execution. | Performs durable storage, payment, email, ticketing, or other side effects. |
| Returns model-safe envelopes for success, validation errors, denials, approval-required actions, and failures. | Shows approval UI, collects approvals, and commits side effects through host-controlled lifecycle APIs. |
| Scores deterministic eval fixtures and provider conformance cases. | Produces candidate results from tests, mocks, or optional live runs. |

## Try It

Install and validate the public examples:

```bash
npm install
npm run validate
```

Build the CLI and inspect the example registry:

```bash
npm run build
node dist/cli.js inspect examples
```

Export OpenAI Responses function tools without calling a model:

```bash
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
```

Run the public mock runtime flow:

```bash
node examples/runtime-support-billing/run-mock.mjs
```

Run deterministic evals:

```bash
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

For expected output excerpts and what each command proves, use
[Start here](docs/start-here.md).

## Documentation Map

Start and concepts:

- [Start here](docs/start-here.md)
- [Getting started checklist](docs/getting-started.md)
- [OpenAI walkthrough](docs/openai-walkthrough.md)
- [Glossary](docs/glossary.md)
- [1.0 spec](docs/spec.md)
- [Host responsibilities](docs/host-responsibilities.md)

Runtime and policy:

- [Runtime contracts](docs/runtime.md)
- [Action lifecycle](docs/action-lifecycle.md)
- [Policy broker](docs/policy-broker.md)
- [Control plane](docs/control-plane.md)
- [OpenAI Responses runtime](docs/openai-runtime.md)
- [OpenAI Responses descriptor adapter](docs/openai-responses.md)

Evals and providers:

- [Eval runner](docs/eval-runner.md)
- [Eval manifests](docs/evals.md)
- [Live evals](docs/live-evals.md)
- [Provider foundation](docs/providers.md)
- [Provider conformance](docs/provider-conformance.md)
- [Anthropic Claude runtime](docs/anthropic-runtime.md)
- [Google Gemini runtime](docs/gemini-runtime.md)
- [Vercel AI SDK bridge](docs/ai-sdk-runtime.md)
- [LangChain/LangGraph bridge](docs/langchain-runtime.md)
- [MCP server runtime](docs/mcp-server-runtime.md)
- [Semantic Kernel compatibility](docs/semantic-kernel-runtime.md)
- [AWS reference integration](docs/aws-runtime.md)
- [Observability runtime](docs/observability-runtime.md)

Reference and release:

- [API reference](docs/api.md)
- [Capability manifests](docs/capability-manifests.md)
- [Interoperability](docs/interoperability.md)
- [Adapter roadmap](docs/adapter-roadmap.md)
- [Migration 0.1 to 1.0](docs/migration-0.1-to-1.0.md)
- [Release checklist](docs/release.md)
- [CHANGELOG](CHANGELOG.md)
- [CONTRIBUTING](CONTRIBUTING.md)
- [SECURITY](SECURITY.md)

## Examples

The public examples are synthetic:

- `examples/support/` describes a support ticket and refund workflow.
- `examples/scheduling/` describes scheduling capabilities.
- `examples/runtime-support-billing/` runs a mock route, read, prepare,
  approval, and commit flow without credentials.
- `examples/providers/` contains README-only provider examples.

Private drafts, raw prompts, traces, provider payloads, generated local docs,
and local-only artifacts are excluded from tracked files. See `AGENTS.md` for
the workspace boundary.

## Development Checks

```bash
npm run build
npm test
npm run validate
npm run check
```

Provider live tests are opt-in and require explicit environment variables.
Normal checks use mock clients, descriptor exports, synthetic fixtures, and no
live model calls.

## License

MIT
