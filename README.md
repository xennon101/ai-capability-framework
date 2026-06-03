# AI Capability Framework

AI Capability Framework (AICF) is a small public framework for describing what an
AI-enabled application is allowed to know, decide, and do.

The repository contains:

- JSON Schema contracts for capability, entity, and eval manifests.
- Synthetic examples that show how to describe a capability without exposing
  private application internals.
- A TypeScript core library and `aicf` CLI for loading, validating, and
  inspecting manifests.
- An OpenAI Responses adapter that exports safe function tool definitions
  without calling models or executing capabilities.
- A deterministic eval runner for scoring public-safe candidate fixtures
  without API keys or live model calls.
- A normative `1.0` public spec for capability IDs, tiers, lifecycle, and
  public-safe examples.

## Why This Exists

AI products are easier to govern when model-facing behavior is represented as
explicit application capabilities instead of broad tool lists or hidden prompts.
AICF separates semantic interpretation from deterministic application control:

- Models interpret the user goal and select from a small set of relevant
  capabilities.
- Application code validates inputs, checks authorization, enforces policy,
  executes side effects, and records audit evidence.
- Evals verify that capability selection, tool arguments, approval boundaries,
  and safety behavior remain stable.

## Quick Start

Install dependencies and validate the public examples:

```bash
npm install
npm run validate
```

Inspect the public example registry:

```bash
npm run inspect
```

Evaluate a deterministic capability decision:

```bash
npm run build
node dist/cli.js decide examples --request examples/support/decisions/support.refund.prepare_case.approval_required.json
```

Export OpenAI Responses function tools from a validated registry:

```bash
npm run build
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
```

Run deterministic evals against a public-safe candidate fixture:

```bash
npm run build
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

Start a capability manifest excerpt:

```yaml
schema_version: "1.0"
id: support.refund.prepare_case
version: 1.0.0
status: active
name: Prepare refund case
summary: Prepare a refund case for review without issuing money.
capability_type: write_prepare_only
autonomy_tier: A2
risk_tier: medium
```

Then add the required input/output schemas, side-effect metadata,
authorization rules, policy gates, lifecycle flags, observability settings, and
eval references. Complete copyable examples live under `examples/`.

## Repository Layout

```text
schemas/   JSON Schema contracts for AICF manifests
examples/  Synthetic public example capabilities, entities, and evals
conformance/ Public valid and invalid fixtures for contract review
docs/      Public usage guidance
src/       TypeScript core, CLI, generated types, and tests
scripts/   Local type-generation utilities
```

Start with [the 1.0 spec](docs/spec.md), read the
[API guide](docs/api.md), the [control-plane guide](docs/control-plane.md), the
[OpenAI Responses adapter](docs/openai-responses.md), the
[eval runner guide](docs/eval-runner.md), the
[host responsibilities guide](docs/host-responsibilities.md), and the
[interoperability guide](docs/interoperability.md). For future provider and
runtime adapters, see the [adapter roadmap](docs/adapter-roadmap.md), then
inspect the examples.

Release and collaboration docs:
[CHANGELOG](CHANGELOG.md), [CONTRIBUTING](CONTRIBUTING.md),
[SECURITY](SECURITY.md), the [migration guide](docs/migration-0.1-to-1.0.md),
and the [release checklist](docs/release.md).

Private drafts and source material are intentionally excluded from this public
repository. See `AGENTS.md` for the tracking boundary used in this workspace.

## Core Concepts

Capability manifest:
Describes a model-selectable application capability, including its input/output
contract, risk tier, side effects, authorization requirements, policy gates, and
observability expectations.

Entity manifest:
Describes an application entity that capabilities may read or act on. It records
canonical identifiers, data classification, relationships, and model-facing
guidance.

Eval case:
Describes a regression case for capability selection, argument extraction,
approval boundaries, refusals, and safety behavior.

Action lifecycle:
Side-effecting capabilities should generally follow a prepare, preview, approve,
commit, verify, and audit lifecycle. Low-risk read or compute capabilities can
use simpler flows when policy allows it.

## Validation

`npm run validate` parses all schema files, then validates every YAML/JSON
example under:

- `examples/**/capabilities/`
- `examples/**/entities/`
- `examples/**/evals/`

The script fails on malformed examples or schema violations.

GitHub Actions runs type generation, generated-type freshness checks, build,
tests, and validation on pushes and pull requests.

## TypeScript API

AICF exposes a small no-execution TypeScript surface:

- `loadManifests(options)`
- `validateManifests(manifests, options)`
- `buildRegistry(manifests)`
- `inspectRegistry(registry)`
- `decideCapability(registry, request)`
- `evaluatePolicy(capability, request)`
- `evaluateLifecycle(capability, request)`
- `buildOpenAIResponsesTools(registry, options)`
- `parseOpenAIResponsesToolCall(toolset, call)`
- `toOpenAIResponsesToolName(capabilityId, options)`
- `loadEvalResults(path)`
- `scoreEvalCase(evalCase, candidate, registry)`
- `runEvalSuite(registry, candidates, options)`

Generated public types include `CapabilityManifest`, `EntityManifest`, and
`EvalCase`. Decision types include `DecisionRequest`, `DecisionResult`,
`DecisionReason`, `DecisionOperation`, and `DecisionStatus`. OpenAI adapter
types include `OpenAIResponsesToolset`, `OpenAIResponsesFunctionTool`, and
`OpenAIResponsesToolBinding`. Eval runner types include `EvalResultFixture`,
`EvalCandidateResult`, `EvalSuiteResult`, `EvalCaseResult`, and
`EvalScorerResult`.

## License

MIT. See [LICENSE](LICENSE).
