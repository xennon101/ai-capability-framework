# AI Capability Framework

AI Capability Framework Core (AICF Core) is a provider-agnostic AI capability
framework. It turns application functions, data access, and workflows into
typed, permissioned, versioned, observable, and evaluated capabilities that can
be safely exposed to AI models and agent frameworks.

It supports adapters and bridges for OpenAI, Anthropic Claude, Google Gemini,
Vercel AI SDK, Model Context Protocol, LangChain/LangGraph, and Semantic
Kernel-compatible MCP/OpenAPI workflows.

The repository contains:

- JSON Schema contracts for capability, entity, and eval manifests.
- Synthetic examples that show how to describe a capability without exposing
  private application internals.
- A TypeScript core library and `aicf` CLI for loading, validating, inspecting,
  and slicing manifests.
- Provider adapters that export safe tool descriptors without calling models.
- Runtime contracts for no-model read/prepare handler execution and
  host-controlled action lifecycle.
- An optional OpenAI Responses runtime loop for caller-provided clients.
- Optional observability, Langfuse, live eval, and Promptfoo export subpaths.
- Optional AWS reference adapters for durable runtime state, approval workflow
  handoff, and event publishing.
- Optional MCP server runtime and OpenAI Agents SDK bridge surfaces.
- A provider-neutral shared foundation plus optional Anthropic Claude and Google
  Gemini runtimes for multi-vendor model/tool loops.
- Optional framework bridges for Vercel AI SDK, LangChain/LangGraph, and
  Semantic Kernel compatibility.
- A descriptor/mock-only provider conformance matrix that checks one routed
  capability slice across supported provider and framework targets.
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

Run the optional OpenAI Responses runtime mock tests:

```bash
npm run build
npm run test:openai:mock
```

Run the public runtime support/billing mock example:

```bash
npm run build
node examples/runtime-support-billing/run-mock.mjs
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
examples/runtime-support-billing/ Public mock runtime flow
conformance/ Public valid and invalid fixtures for contract review
docs/      Public usage guidance
src/       TypeScript core, CLI, generated types, and tests
scripts/   Local type-generation utilities
```

Start with [the 1.0 spec](docs/spec.md), read the
[API guide](docs/api.md), the [control-plane guide](docs/control-plane.md), the
[runtime contracts guide](docs/runtime.md), the
[action lifecycle guide](docs/action-lifecycle.md), the
[policy broker guide](docs/policy-broker.md), the
[provider foundation guide](docs/providers.md), the
[provider conformance guide](docs/provider-conformance.md), the
[Vercel AI SDK bridge](docs/ai-sdk-runtime.md), the
[Anthropic Claude runtime](docs/anthropic-runtime.md), the
[Google Gemini runtime](docs/gemini-runtime.md), the
[LangChain and LangGraph bridge](docs/langchain-runtime.md), the
[Semantic Kernel compatibility guide](docs/semantic-kernel-runtime.md), the
[OpenAI Responses adapter](docs/openai-responses.md), the
[OpenAI Responses runtime](docs/openai-runtime.md), the
[observability runtime](docs/observability-runtime.md), the
[live evals guide](docs/live-evals.md), the
[AWS runtime guide](docs/aws-runtime.md), the
[MCP server runtime guide](docs/mcp-server-runtime.md), the
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

Runtime contracts are available from a separate no-model subpath:

```ts
import {
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker
} from "ai-capability-framework/runtime";
```

The runtime subpath provides context building, redaction, deterministic routing,
policy brokering, read/prepare handler execution, host-controlled action
lifecycle, in-memory reference stores, audit events, and model-safe runtime
envelopes. It does not call models or expose commit through model tool
execution.

OpenAI Responses runtime APIs are available from a separate optional subpath:

```ts
import {
  runOpenAIResponses,
  createDefaultOpenAIResponsesClient
} from "ai-capability-framework/openai";
```

The OpenAI subpath runs a bounded non-streaming Responses tool loop with
caller-provided or dynamically imported OpenAI clients. It exposes routed read
and prepare capabilities only, serializes model-safe runtime envelopes, and does
not expose commit tools to the model.

Anthropic Claude Messages runtime APIs are available from a provider subpath:

```ts
import {
  runAnthropicMessages,
  createDefaultAnthropicMessagesClient
} from "ai-capability-framework/providers/anthropic";
```

The Anthropic subpath runs a bounded Messages tool-use loop with
caller-provided or dynamically imported Anthropic clients. It formats
Claude-compatible `tool_result` messages and still executes only AICF-routed
read/prepare tools.

Google Gemini GenerateContent runtime APIs are available from a provider
subpath:

```ts
import {
  runGeminiGenerateContent,
  createDefaultGeminiClient
} from "ai-capability-framework/providers/gemini";
```

The Gemini subpath runs a bounded GenerateContent function-calling loop with
caller-provided or dynamically imported Google GenAI clients. It formats
Gemini-compatible `functionResponse` parts and still executes only AICF-routed
read/prepare tools.

Vercel AI SDK bridge APIs are available from a provider subpath:

```ts
import {
  buildAiSdkTools,
  runAiSdkGenerateText
} from "ai-capability-framework/providers/ai-sdk";
```

The AI SDK subpath creates executor-backed AI SDK tools and optional
host-supplied `generateText`/`streamText` wrappers. Host applications still own
model/provider selection, and AICF still executes only routed read/prepare
tools.

LangChain and LangGraph bridge APIs are available from a provider subpath:

```ts
import {
  buildLangChainTools,
  buildLangGraphToolNode
} from "ai-capability-framework/providers/langchain";
```

The LangChain subpath creates executor-backed LangChain tools and a thin
host-supplied `ToolNode` helper for LangGraph. Host applications still own
agent/model orchestration, and AICF still executes only routed read/prepare
tools.

Semantic Kernel compatibility APIs are available from a provider subpath:

```ts
import {
  exportSemanticKernelOpenApiPlugin,
  getSemanticKernelMcpIntegrationGuide
} from "ai-capability-framework/providers/semantic-kernel";
```

The Semantic Kernel subpath recommends the AICF MCP server path and can generate
OpenAPI 3.1 plugin metadata for host-owned executor routes. It does not add a
Semantic Kernel runtime dependency, call models, execute handlers, or expose
commit tools.

MCP provider descriptors are available from a provider subpath:

```ts
import { buildMcpProviderToolDescriptors } from "ai-capability-framework/providers/mcp";
```

The MCP provider subpath builds descriptor-only MCP tool metadata from routed
AICF slices. The separate MCP server runtime executes those tools through
`AicfToolExecutor`.

Observability and eval-ops APIs are also separate optional subpaths:

```ts
import { CollectingTraceSink } from "ai-capability-framework/observability";
import { runLiveEvalSuite } from "ai-capability-framework/evals-live";
import { exportPromptfooSuite } from "ai-capability-framework/promptfoo";
```

These subpaths use mock/fake clients in default tests and do not store raw
prompts, provider payloads, traces, or private data by default.

AWS reference adapters are available from their own optional subpath:

```ts
import { DynamoDbPreparedActionStore } from "ai-capability-framework/aws";
```

The AWS subpath provides DynamoDB-backed runtime stores, Step Functions approval
handoff, EventBridge event publishing, and fake clients for tests. It does not
provision infrastructure or make AWS part of root/runtime/OpenAI imports.

MCP server and OpenAI Agents SDK bridge APIs are isolated too:

```ts
import { AicfMcpServer } from "ai-capability-framework/mcp-server";
import { buildAgentsSdkTools } from "ai-capability-framework/openai";
```

The MCP server core exposes routed read/prepare tools through host-owned MCP
transports. The Agents bridge creates executor-backed function tools. Neither
surface exposes commit tools to models.

## License

MIT. See [LICENSE](LICENSE).
