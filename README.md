# AI Capability Framework

AI Capability Framework Core (AICF Core) is a small public framework for
describing what an AI-enabled application is allowed to know, decide, and expose
to model or agent runtimes.

The repository contains:

- JSON Schema contracts for capability, entity, and eval manifests.
- Synthetic examples that show how to describe a capability without exposing
  private application internals.
- A TypeScript core library and `aicf` CLI for loading, validating, inspecting,
  and slicing manifests.
- Provider and runtime adapters that export safe tool descriptors without
  calling models or executing capabilities.
- A standard tool result envelope and deterministic eval runner for scoring
  public-safe candidate fixtures
  without API keys or live model calls.
- A normative `1.0` public spec for capability IDs, tiers, lifecycle, and
  public-safe examples.

## Why This Exists

AI products are easier to govern when model-facing behavior is represented as
explicit application capabilities instead of broad tool lists or hidden prompts.
AICF Core separates semantic interpretation from deterministic application
control:

- Models interpret the user goal and select from a small set of relevant
  capabilities.
- AICF Core validates contracts, preflights metadata, exports descriptors, and
  scores eval fixtures.
- Application code enforces real authorization, executes side effects, stores
  approvals/idempotency/audit data, and owns runtime behavior.
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

Export another adapter shape:

```bash
npm run build
node dist/cli.js anthropic-tools examples --context examples/support/openai/context.support_agent.json
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
[adapter guide](docs/adapters.md), the
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

`npm run validate` parses every public YAML/JSON file under `examples/`, then
validates known fixture directories and manifests:

- `examples/**/capabilities/`
- `examples/**/entities/`
- `examples/**/evals/`
- `examples/**/eval-results/`
- `examples/**/decisions/`
- `examples/**/openai/context*.json`

The script fails on malformed examples, unknown public fixture types, schema
violations, invalid embedded capability input/output schemas, unsafe semantic
manifest invariants, duplicate IDs, and missing eval references.

GitHub Actions runs type generation, generated-type freshness checks, build,
tests, and validation on pushes and pull requests.

## TypeScript API

AICF Core exposes a small no-execution TypeScript surface:

- `loadManifests(options)`
- `validateManifests(manifests, options)`
- `validatePublicFixtures(fixtures)`
- `buildRegistry(manifests)`
- `inspectRegistry(registry)`
- `decideCapability(registry, request)`
- `evaluatePolicy(capability, request)`
- `evaluateLifecycle(capability, request)`
- `selectCapabilitySlice(input)`
- `buildOpenAIResponsesTools(registry, options)`
- `parseOpenAIResponsesToolCall(toolset, call)`
- `toOpenAIResponsesToolName(capabilityId, options)`
- `buildAnthropicClaudeTools(registry, options)`
- `parseAnthropicClaudeToolUse(toolset, toolUse)`
- `buildGeminiFunctionDeclarations(registry, options)`
- `parseGeminiFunctionCall(functionSet, functionCall)`
- `buildAiSdkTools(registry, options)`
- `parseAiSdkToolCall(toolset, toolCall)`
- `buildMcpToolDescriptors(registry, options)`
- `parseMcpToolCall(toolset, toolCall)`
- `buildLangChainToolDescriptors(registry, options)`
- `parseLangChainToolCall(toolset, toolCall)`
- `buildSemanticKernelFunctions(registry, options)`
- `parseSemanticKernelFunctionCall(functionSet, functionCall)`
- `loadEvalResults(path)`
- `scoreEvalCase(evalCase, candidate, registry)`
- `runEvalSuite(registry, candidates, options)`
- `okToolResult(input)`
- `deniedToolResult(input)`
- `approvalRequiredToolResult(input)`
- `unavailableToolResult(input)`
- `errorToolResult(input)`
- `toModelFacingToolResult(envelope)`

Generated public types include `CapabilityManifest`, `EntityManifest`, and
`EvalCase`. Decision types include `DecisionRequest`, `DecisionResult`,
`DecisionReason`, `DecisionOperation`, and `DecisionStatus`. OpenAI adapter
types include `OpenAIResponsesToolset`, `OpenAIResponsesFunctionTool`, and
`OpenAIResponsesToolBinding`. Eval runner types include `EvalResultFixture`,
`EvalCandidateResult`, `EvalSuiteResult`, `EvalCaseResult`, and
`EvalScorerResult`.

## License

MIT. See [LICENSE](LICENSE).
