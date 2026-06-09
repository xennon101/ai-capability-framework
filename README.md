# AI Capability Framework (AICF)

<p align="center">
  <img src="docs/assets/aicf-logo.svg" alt="AI Capability Framework logo" width="520">
</p>

AI Capability Framework (AICF) is a provider-agnostic AI capability framework: a
governed capability layer for AI-accessible application functionality. It helps
application teams describe what an AI system is allowed to do, expose only the right
tools to a model, validate every model tool call, and prove the behavior with
deterministic evals.

AICF is not an agent framework. It is a governed capability layer for AI-accessible
application functionality.

Models propose; applications validate, authorize, execute, and audit.

AICF supports OpenAI, Anthropic Claude, Google Gemini, Vercel AI SDK, Model Context
Protocol, LangChain/LangGraph, and Semantic Kernel-compatible MCP/OpenAPI workflows.
OpenAI is one adapter, not the architecture.

## How AICF Works

```text
manifests
  -> validated registry
  -> routed capability slice
  -> optional runtime controls
  -> provider tools
  -> runtime validation
  -> read/prepare execution
  -> approval/commit lifecycle
  -> optional governance control plane
  -> evals
  -> sanitized replay traces
  -> evidence export
  -> optional content provenance sidecars
```

In plain terms:

1. You write public-safe manifests that describe capabilities, entities, and eval cases.
2. AICF validates those manifests and builds a registry.
3. Runtime routing picks the smallest safe slice of capabilities for a user request.
4. Optional controls can deny, force approval, make matching capabilities read-only, or
   enforce per-run budgets.
5. Provider adapters turn that slice into tool definitions for OpenAI or another
   provider.
6. Tool calls map back to AICF capability IDs and are validated against the original
   schema.
7. The runtime can execute host-registered read and prepare handlers.
8. Commit remains host-controlled through prepared actions, approvals, idempotency, and
   optional audit ledger records.
9. An optional self-hosted control plane can review capabilities, evidence, approvals,
   controls, and redacted replay metadata.
10. Eval fixtures prove selection, arguments, refusal, approval, and no-commit
    boundaries without calling a model.
11. Sanitized replay traces can be rerun or converted into review-required regression
    eval drafts.
12. Evidence packs summarize public-safe governance, eval, conformance, approval,
    retention, and coverage status for review.
13. Optional provenance hooks attach refs-and-hashes metadata to generated
    customer-facing content through host-owned publishing or signing pipelines.

## Start Here

- Supported Node.js versions: 20.x, 22.x, and 24.x. Package metadata uses
  `engines.node >=20`.
- New to AICF: [Start here](docs/start-here.md)
- Provider-neutral quickstart:
  [no-key path](docs/getting-started/provider-neutral-quickstart.md)
- Choose a runtime: [provider/runtime guide](docs/providers/choose-a-runtime.md)
- Optional provider quickstarts: [OpenAI](docs/getting-started/openai-quickstart.md),
  [Anthropic](docs/getting-started/anthropic-quickstart.md), and
  [Gemini](docs/getting-started/gemini-quickstart.md)
- Documentation index: [Docs](docs/index.md)
- Concrete OpenAI flow: [OpenAI walkthrough](docs/openai-walkthrough.md)
- Main terms: [Glossary](docs/glossary.md)
- Full API reference: [API](docs/api.md)
- Public API policy: [root and subpath exports](docs/api/public-api-policy.md)
- Agent skills package: [AICF Agent Skills](agent-skills/README.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Release/certification:
  [Final v1 certification](docs/public-framework/v1-certification.md)
- Final certification matrix:
  [local release gate](docs/public-framework/final-certification-matrix.md)
- npm release preflight:
  [package ownership and tags](docs/public/npm-release-preflight.md)
- License decision: [MIT for v1](docs/public-framework/license-decision.md)
- Dependency license exceptions:
  [reviewed exception register](docs/public/license-exceptions.md)

## What AICF Does / What Your App Does

| AICF does                                                                                                      | Your app does                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Validates capability, entity, eval, context, decision, and result contracts.                                   | Owns production auth, account state, entitlements, and tenant boundaries.                                 |
| Routes a small model-facing capability slice.                                                                  | Decides which user request and host context to pass into AICF.                                            |
| Exports provider tool definitions and binding maps.                                                            | Calls OpenAI or another provider with a caller-provided client.                                           |
| Parses provider tool calls back to capability IDs.                                                             | Provides real data access and business logic handlers.                                                    |
| Validates tool arguments with AICF schemas before execution.                                                   | Performs durable storage, payment, email, ticketing, or other side effects.                               |
| Returns model-safe envelopes for success, validation errors, denials, approval-required actions, and failures. | Shows approval UI, collects approvals, and commits side effects through host-controlled lifecycle APIs.   |
| Can write optional canonical audit ledger records with redacted refs and hashes.                               | Stores production audit evidence, retention policy, and compliance workflows in your own systems.         |
| Can evaluate optional kill switches, circuit breakers, and per-run budgets.                                    | Owns production control stores, authenticated operator workflows, and incident response.                  |
| Can govern whether host-supplied memory summaries may become model context.                                    | Owns memory storage, consent, deletion, recall, identity resolution, and tenant scoping.                  |
| Provides an optional self-hostable control-plane API and reference UI for public-safe review.                  | Owns production access control, durable control-plane storage, approval identity, and evidence retention. |
| Can export public-safe evidence packs with gaps and disclaimers.                                               | Owns compliance decisions, audit engagement, legal review, and production evidence systems.               |
| Can create public-safe generated-content provenance sidecars and adapter-hook inputs.                          | Owns real content signing, document/media embedding, CMS integration, and authenticity claims.            |
| Scores deterministic eval fixtures and provider conformance cases.                                             | Produces candidate results from tests, mocks, or optional live runs.                                      |

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

- [Documentation index](docs/index.md)
- [Start here](docs/start-here.md)
- [Getting started checklist](docs/getting-started.md)
- [Installation](docs/getting-started/installation.md)
- [Provider-neutral quickstart](docs/getting-started/provider-neutral-quickstart.md)
- [Quickstart](docs/getting-started/quickstart.md)
- [Concepts](docs/getting-started/concepts.md)
- [OpenAI quickstart](docs/getting-started/openai-quickstart.md)
- [Anthropic quickstart](docs/getting-started/anthropic-quickstart.md)
- [Gemini quickstart](docs/getting-started/gemini-quickstart.md)
- [OpenAI walkthrough](docs/openai-walkthrough.md)
- [Glossary](docs/glossary.md)
- [Public API policy](docs/api/public-api-policy.md)
- [1.0 spec](docs/spec.md)
- [Host responsibilities](docs/host-responsibilities.md)

Runtime and policy:

- [Governance lifecycle, risk, compatibility, and impact](docs/governance/index.md)
- [Governance CI gate](docs/governance/gate.md)
- [Audit ledger records](docs/audit/index.md)
- [Trust, taint, redaction, and retention](docs/security/trust-taint-redaction.md)
- [Governed memory and preferences](docs/memory.md)
- [Capability-aware security packs](docs/security/security-packs.md)
- [Runtime controls](docs/controls/index.md)
- [Runtime contracts](docs/runtime.md)
- [Action lifecycle](docs/action-lifecycle.md)
- [Policy broker](docs/policy-broker.md)
- [Control plane](docs/control-plane.md)
- [OpenAI Responses runtime](docs/openai-runtime.md)
- [OpenAI Responses descriptor adapter](docs/openai-responses.md)

Evals and providers:

- [Eval runner](docs/eval-runner.md)
- [Eval manifests](docs/evals.md)
- [Security pack eval templates](docs/security/security-packs.md)
- [Replay and trace-to-golden](docs/evals/replay-and-trace-to-golden.md)
- [Live evals](docs/live-evals.md)
- [EvalOps export interfaces](docs/evalops.md)
- [Evidence export](docs/evidence.md)
- [Content provenance hooks](docs/provenance.md)
- [Provider foundation](docs/providers.md)
- [Choose a provider/runtime](docs/providers/choose-a-runtime.md)
- [Provider conformance](docs/providers/conformance.md)
- [Anthropic Claude runtime](docs/anthropic-runtime.md)
- [Google Gemini runtime](docs/gemini-runtime.md)
- [Vercel AI SDK bridge](docs/ai-sdk-runtime.md)
- [LangChain/LangGraph bridge](docs/langchain-runtime.md)
- [MCP server runtime](docs/mcp-server-runtime.md)
- [Semantic Kernel compatibility](docs/semantic-kernel-runtime.md)
- [AWS reference integration](docs/aws-runtime.md)
- [AWS production reference adapters](docs/aws/production-reference.md)
- [Observability runtime](docs/observability-runtime.md)

Reference and release:

- [API reference](docs/api.md)
- [Capability manifests](docs/capability-manifests.md)
- [Interoperability](docs/interoperability.md)
- [Adapter roadmap](docs/adapter-roadmap.md)
- [Migration 0.1 to 1.0](docs/migration-0.1-to-1.0.md)
- [Release checklist](docs/release.md)
- [Final v1.0 certification](docs/public-framework/v1-certification.md)
- [npm release preflight](docs/public/npm-release-preflight.md)
- [CHANGELOG](CHANGELOG.md)
- [CONTRIBUTING](CONTRIBUTING.md)
- [SECURITY](SECURITY.md)

## Examples

The public examples are synthetic:

- `examples/01-basic-read-capability/` through `examples/11-control-plane/` provide
  numbered README-first tutorials.
- `examples/support/` describes a support ticket and refund workflow.
- `examples/scheduling/` describes scheduling capabilities.
- `examples/runtime-support-billing/` runs a mock route, read, prepare, approval, and
  commit flow without credentials.
- `examples/control-plane/` runs a local governance control-plane reference app with
  synthetic seed state and ignored local mutations.
- `examples/aws/` documents credential-free AWS adapter wiring and production host
  responsibilities.
- `examples/providers/` contains README-only provider examples.

Private drafts, raw prompts, traces, provider payloads, generated local docs, and
local-only artifacts are excluded from tracked files. See `AGENTS.md` for the workspace
boundary.

## Development Checks

Final v1.0 certification:

```bash
npm run check:certification
```

The normal development gate is shorter:

```bash
npm run lint
npm run build
npm run typecheck
npm run docs:build
npm test
npm run validate
npm run conformance
npm run gate:examples
npm run check
```

Provider live tests are opt-in and require explicit environment variables. Normal checks
use mock clients, descriptor exports, synthetic fixtures, and no live model calls.

For artifact review:

```bash
npm run check:package
npm run skills:ci
npm run skills:check
npm run skills:pack:dry
npm pack
npm run release:preflight:npm
npm run release:publish:dry
npm run archive:source
npm run check:source-archive
```

Release tags publish two npm artifacts from the same commit and version:
`ai-capability-framework` and `@aicf/agent-skills`. For example, package version `1.0.0`
uses tag `v1.0.0` and the `latest` dist tag for both packages.

Use `npm pack` for npm package review and `npm run archive:source` for public source
review. Do not zip the working directory manually; raw workspace archives can include
`.git/`, dependencies, generated output, private notes, traces, logs, prompts, or
provider payloads.

CI also runs dedicated docs, security, release dry-run, package hygiene, conformance,
and governance-gate workflows. See
[Release process](docs/public-framework/release-process.md) and
[Release checklist](docs/release.md). npm ownership and dist-tag checks are documented
in [npm release preflight](docs/public/npm-release-preflight.md). Final v1.0
certification is documented in
[Final v1.0 certification](docs/public-framework/v1-certification.md).

## License

MIT
