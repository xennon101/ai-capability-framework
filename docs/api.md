# API

AICF Core exposes a small TypeScript API and the `aicf` CLI. The package is
public npm release-candidate material, and the exported surface is treated as
public developer API.

Import from the package root:

```ts
import {
  buildRegistry,
  decideCapability,
  loadManifests,
  validateManifests
} from "ai-capability-framework";
```

## Boundaries

The Core root API does not call models, execute capabilities, verify host
authorization, persist actions, collect approvals, write audit logs, or perform
side effects. Host applications own production authorization, durable storage,
approval workflows, audit retention, provider calls, and final side-effect
execution.

Runtime control utilities are available from a separate subpath:

```ts
import {
  DefaultCapabilityRouter,
  DefaultContextBuilder,
  DefaultPolicyBroker
} from "ai-capability-framework/runtime";
```

The runtime subpath adds context building, redaction, deterministic routing,
policy brokering, handler registry utilities, no-model read/prepare execution,
host-controlled action lifecycle, in-memory reference stores, audit events, and
runtime envelope helpers. It still does not call providers or expose commit
through model tool execution.

The optional OpenAI Responses runtime is available from its own subpath:

```ts
import {
  runOpenAIResponses,
  createOpenAIResponsesClientFromSdk
} from "ai-capability-framework/openai";
```

This subpath can call a caller-provided OpenAI-compatible client. The package
root and runtime subpath do not import OpenAI code.

Observability and eval-ops imports are also isolated:

```ts
import { CollectingTraceSink } from "ai-capability-framework/observability";
import { LangfuseTraceSink } from "ai-capability-framework/langfuse";
import { runLiveEvalSuite } from "ai-capability-framework/evals-live";
import { exportPromptfooSuite } from "ai-capability-framework/promptfoo";
```

AWS reference integrations are isolated in their own optional subpath:

```ts
import { DynamoDbPreparedActionStore } from "ai-capability-framework/aws";
```

The AWS subpath is for durable-store and workflow handoff references. Root,
runtime, OpenAI, and eval imports do not import AWS SDK modules.

MCP server runtime imports are separate as well:

```ts
import { AicfMcpServer } from "ai-capability-framework/mcp-server";
```

Shared multi-provider foundation imports are available from:

```ts
import { createProviderToolNameMap } from "ai-capability-framework/providers";
```

Provider-specific optional subpaths cover OpenAI, Anthropic Claude, Google
Gemini, Vercel AI SDK, LangChain/LangGraph, MCP, Semantic Kernel compatibility,
and descriptor/mock-only conformance. OpenAI is one adapter, not the
architecture; provider SDK validation is advisory and AICF remains the
validation, policy, lifecycle, approval, and envelope authority.

## Core Manifest APIs

- `loadManifests(options)` reads YAML and JSON manifests from convention paths
  and parses public non-manifest fixtures.
- `validateManifests(manifests, options)` validates schemas, duplicate IDs, and
  manifest cross-references, embedded capability schemas, and semantic
  invariants.
- `validatePublicFixtures(fixtures)` validates decision requests, adapter
  contexts, and eval-result fixtures discovered by `loadManifests`.
- `buildRegistry(manifests)` returns lookup maps and grouped manifest arrays.
- `inspectRegistry(registry)` returns counts, capability groupings, eval
  coverage, and warnings.

Diagnostics use `AicfDiagnostic` with `code`, `path`, optional `kind`, optional
`id`, and a human-readable `message`.

## Decision APIs

- `decideCapability(registry, request, options?)` evaluates select, prepare, or
  commit status for one capability.
- `evaluatePolicy(capability, request)` evaluates deterministic policy metadata.
- `evaluateLifecycle(capability, request)` evaluates lifecycle availability.

Decision results return `status`, `reasons`, `requiredApprovals`, `diagnostics`,
`policy`, `lifecycle`, and an audit preview. The audit preview is not persisted.

The decision path validates prepare/commit args against `input_schema`, denies
missing required `userId` or `tenantId`, enforces active status by default, and
honors `riskCeiling` and `allowedRiskTiers` in request context.

## Capability Slices

- `selectCapabilitySlice(input)` filters a registry deterministically by
  capability IDs, domains, entities, tags, capability types, risk, permissions,
  autonomy, status, restricted side effects, and max count.

Adapter builders accept either a full registry or a selected slice.

## Provider And Runtime Adapters

- `buildOpenAIResponsesTools(registry, options)` exports OpenAI-compatible
  function tools plus bindings, exclusions, and diagnostics.
- `parseOpenAIResponsesToolCall(toolset, call)` maps a Responses
  `function_call` item back to a capability ID and validates arguments.
- `toOpenAIResponsesToolName(capabilityId, options)` converts an AICF capability
  ID into a deterministic OpenAI-safe tool name.
- `buildAnthropicClaudeTools(registry, options)` exports Anthropic Claude tool
  definitions.
- `parseAnthropicClaudeToolUse(toolset, toolUse)` maps Claude `tool_use` blocks
  back to AICF capability requests.
- `buildGeminiFunctionDeclarations(registry, options)` exports Gemini function
  declarations.
- `parseGeminiFunctionCall(functionSet, functionCall)` parses Gemini
  `functionCall` objects.
- `buildAiSdkTools(registry, options)` exports a Vercel AI SDK-compatible tool
  map without `execute` handlers.
- `parseAiSdkToolCall(toolset, toolCall)` parses AI SDK tool calls.
- `buildMcpToolDescriptors(registry, options)` exports MCP tool descriptors.
- `parseMcpToolCall(toolset, toolCall)` parses MCP `tools/call` requests.
- `buildLangChainToolDescriptors(registry, options)` exports LangChain and
  LangGraph descriptor metadata without callable implementations.
- `parseLangChainToolCall(toolset, toolCall)` parses LangChain-style tool calls.
- `buildSemanticKernelFunctions(registry, options)` exports Semantic Kernel
  function metadata.
- `parseSemanticKernelFunctionCall(functionSet, functionCall)` parses Semantic
  Kernel manual invocation calls.

Adapters emit descriptor JSON only. They do not call providers or execute tool
handlers. See [the adapter guide](adapters.md) for output shapes and CLI usage.

Adapter builders exclude disabled, deprecated, draft, and experimental
capabilities by default. Use explicit include options only for compatibility,
development, or test contexts. Restricted side-effect capabilities still require
`includeRestricted: true` and a successful select decision.

## Eval Runner APIs

- `loadEvalResults(path)` reads and validates a public-safe eval result fixture.
- `scoreEvalCase(evalCase, candidate, registry)` scores one eval/candidate pair.
- `runEvalSuite(registry, candidates, options)` scores loaded eval manifests
  against candidate results.
- `formatEvalSuiteResult(result)` formats a readable text summary.

Eval runner output includes suite status, per-eval status, scorer results, and
diagnostics. It scores summarized behavior only, not raw model traces.

## Tool Result Envelope

- `okToolResult(input)`
- `deniedToolResult(input)`
- `approvalRequiredToolResult(input)`
- `unavailableToolResult(input)`
- `errorToolResult(input)`
- `toModelFacingToolResult(envelope)`

These helpers build a standard result wrapper for host applications. They do not
execute tools. `toModelFacingToolResult` strips `private_diagnostics`.

## Runtime Subpath APIs

Runtime imports are intentionally separate from the Core root API:

- `buildRuntimeContext(input)` resolves subject/account context through a
  host-provided `AicfAuthPlatformAdapter`.
- `StaticAuthPlatformAdapter` is for tests and examples only.
- `DefaultContextBuilder` builds deterministic model context and applies
  redaction.
- `DefaultRedactionPolicy` redacts values under sensitive keyed fields.
- `DefaultCapabilityRouter` creates deterministic runtime capability slices.
- `formatCapabilitySliceForModel(input)` renders compact model-facing
  capability guidance.
- `DefaultPolicyBroker` combines Core decisions with runtime context checks and
  optional stricter host policy hooks.
- `AicfHandlerRegistry` registers host capability handlers.
- `AicfToolExecutor` executes read and prepare handlers after validation and
  policy checks.
- `AicfActionLifecycleManager` prepares actions, records approvals, and commits
  stored prepared actions through host-controlled APIs.
- `InMemoryPreparedActionStore`, `InMemoryApprovalStore`,
  `InMemoryIdempotencyStore`, and `InMemoryAuditSink` are dev/test reference
  stores only.
- `createToolEnvelope(input)`, `toModelSafeToolEnvelope(envelope)`, and
  `serializeToolEnvelopeForModel(envelope)` produce runtime model-safe result
  envelopes.

See [the runtime guide](runtime.md) for execution boundaries and host
responsibilities, [action lifecycle](action-lifecycle.md) for prepare, approval,
and commit semantics, and [policy broker](policy-broker.md) for runtime policy
behavior.

## OpenAI Runtime Subpath APIs

OpenAI runtime imports are intentionally separate from both the Core root API
and the no-model runtime subpath:

- `runOpenAIResponses(request)` runs a bounded non-streaming Responses tool
  loop with routed read/prepare capabilities.
- `createOpenAIResponsesClientFromSdk(client)` wraps any compatible client with
  `responses.create()`.
- `createDefaultOpenAIResponsesClient(options?)` dynamically imports the
  optional `openai` SDK and returns a compatible client.
- `extractOpenAIResponsesFunctionCalls(response)` extracts Responses
  `function_call` items from a response-like object.
- `buildOpenAIFunctionCallOutput(call, envelope, options?)` serializes a
  runtime envelope as a `function_call_output` item.
- `buildAgentsSdkTools(options)` builds executor-backed OpenAI Agents SDK
  function-tool definitions from routed AICF capabilities.
- `createDefaultAgentsSdkBridgeFactory(options?)` dynamically imports the
  optional `@openai/agents` SDK and returns a tool factory.

The runner builds context through `AicfContextBuilder`, routes capabilities
through `AicfCapabilityRouter`, exports routed tools with the existing OpenAI
adapter, executes tool calls through `AicfToolExecutor`, and returns
`AicfOpenAIRunResult`.

The OpenAI runtime does not stream, use the OpenAI Agents SDK, expose commit
tools to the model, persist actions, collect approvals, or write durable audit
logs. The Agents SDK bridge is a separate adapter surface that still executes
through AICF runtime policy and lifecycle controls. See
[the OpenAI runtime guide](openai-runtime.md).

## Observability And Eval-Ops APIs

- `CollectingTraceSink`, `NoopTraceSink`, `CompositeTraceSink`, and
  `OpenTelemetryTraceSink` consume sanitized AICF runtime trace events.
- `LangfuseTraceSink` adapts trace events to a client-like Langfuse object.
- `createLangfuseDatasetItemsFromEvalCases()` and
  `createEvalCaseFromLangfuseDatasetItem()` convert public-safe eval cases.
- `runLiveEvalSuite(options)` executes live eval cases through the OpenAI
  runtime with a caller-provided client.
- `evaluateGate(results, gate?)` applies deterministic release gates.
- `createEvalCaseFromTrace(input)` drafts public-safe eval cases from runtime
  summaries.
- `exportPromptfooSuite(options)` generates Promptfoo files without running
  Promptfoo.
- `importPromptfooResults(input)` maps basic Promptfoo JSON results to live eval
  summaries.

These APIs are optional and do not make root imports depend on OpenTelemetry,
Langfuse, Promptfoo, or live model calls. See
[observability runtime](observability-runtime.md) and
[live evals](live-evals.md).

## AWS Reference APIs

The AWS subpath is importable without AWS SDK packages installed. Store,
approval-adapter, and publisher operations require the relevant optional AWS SDK
peer dependency when used.

- `DynamoDbPreparedActionStore`, `DynamoDbApprovalStore`,
  `DynamoDbIdempotencyStore`, and `DynamoDbAuditSink` implement the runtime
  store/sink interfaces with caller-provided DynamoDB document clients.
- `StepFunctionsApprovalAdapter` starts and resumes host-owned approval
  workflows with safe prepared-action summaries.
- `EventBridgeRuntimeEventPublisher` publishes sanitized AICF trace or audit
  events to EventBridge.
- `FakeDynamoDbDocumentClient`, `FakeStepFunctionsClient`, and
  `FakeEventBridgeClient` support API-key-free tests.

These adapters do not provision AWS infrastructure, own approval UI, call
models, or expose commit to model tool execution. See
[AWS runtime](aws-runtime.md).

## MCP Provider Descriptor APIs

- `buildMcpProviderToolDescriptors(request)` exports MCP tool descriptors from
  a routed AICF capability slice.
- `parseMcpProviderToolCall(toolset, call)` maps MCP `tools/call` requests back
  to AICF provider tool calls through generated bindings.
- `toMcpProviderToolName(capabilityId, options?)` creates deterministic
  MCP-safe names.
- `mcpAnnotationsForCapability()` and `mcpSecuritySummaryForCapability()`
  expose public-safe descriptor hints.

The MCP provider subpath is isolated under
`ai-capability-framework/providers/mcp`. It does not start transports, call
models, execute handlers, or expose commit capabilities. The MCP server runtime
uses these descriptors for listing and parsing.

## MCP Server Runtime APIs

- `AicfMcpServer` lists routed MCP tools and executes MCP tool calls through
  `AicfToolExecutor`.
- `registerAicfMcpTools(options)` registers the current routed tool set against
  a caller-provided MCP SDK server object.

The MCP server subpath does not start transports, own auth, trust client-supplied
tenant/user IDs, or expose commit capabilities. See
[MCP server runtime](mcp-server-runtime.md).

## Provider Foundation APIs

- `aicfProviderIds` and `aicfProviderMetadata` describe supported provider and
  framework targets.
- `createProviderToolNameMap(input)` creates deterministic provider-safe tool
  bindings and collision diagnostics.
- `normalizeProviderToolSchema(schema)` validates and clones callable provider
  tool schemas.
- `buildProviderToolDescriptor(input)` creates provider-neutral descriptor
  metadata.
- `parseProviderToolCall(input)` maps provider tool calls back to AICF
  capability IDs through bindings.
- `buildProviderToolResult(input)` returns model-safe provider tool-result
  summaries.
- `executeProviderToolCall(input)` delegates allowed read/prepare calls to
  `AicfToolExecutor`.
- `loadOptionalProviderDependency(input)` dynamically loads optional SDKs and
  throws actionable safe errors when missing.

The provider foundation does not call models, import provider SDKs, expose
commit tools, or log raw provider payloads. See
[provider foundation](providers.md).

## Provider Conformance APIs

- `listProviderTargets()` returns supported provider and bridge targets.
- `exportProviderTools(input)` exports descriptor JSON for a target from a
  selected AICF capability slice.
- `runProviderConformanceSuite(input)` runs deterministic mock conformance
  cases.
- `formatProviderConformanceReport(report, format)` formats conformance output.

The conformance subpath is isolated under
`ai-capability-framework/providers/conformance` and does not call live
providers. See [provider conformance](provider-conformance.md).

## Anthropic Runtime Subpath APIs

- `buildAnthropicTools(input)` exports Claude client tool definitions from a
  routed AICF capability slice.
- `parseAnthropicToolUseBlocks(toolset, blocks)` maps Claude `tool_use` blocks
  back to AICF provider tool calls through the generated binding map.
- `buildAnthropicToolResultMessage(results)` formats model-safe AICF provider
  results as Claude `tool_result` user messages.
- `createAnthropicClientFromSdk(client)` wraps a compatible host-owned
  Anthropic SDK client.
- `createDefaultAnthropicMessagesClient(options?)` dynamically imports optional
  `@anthropic-ai/sdk`.
- `runAnthropicMessages(request)` runs a bounded Claude Messages loop and
  delegates read/prepare execution to `AicfToolExecutor`.

The Anthropic runtime is isolated under
`ai-capability-framework/providers/anthropic`; root, runtime, OpenAI, and shared
provider imports do not require the Anthropic SDK. See
[Anthropic runtime](anthropic-runtime.md).

## Gemini Runtime Subpath APIs

- `buildGeminiFunctionDeclarations(input)` exports Gemini function declarations
  from a routed AICF capability slice.
- `parseGeminiFunctionCalls(declarationSet, calls)` maps Gemini
  `functionCall` objects back to AICF provider tool calls through the generated
  binding map.
- `buildGeminiFunctionResponseParts(results)` formats model-safe AICF provider
  results as Gemini `functionResponse` parts.
- `createGeminiClientFromSdk(client)` wraps a compatible host-owned Google
  GenAI SDK client.
- `createDefaultGeminiClient(options?)` dynamically imports optional
  `@google/genai`.
- `runGeminiGenerateContent(request)` runs a bounded GenerateContent
  function-calling loop and delegates read/prepare execution to
  `AicfToolExecutor`.

The Gemini runtime is isolated under
`ai-capability-framework/providers/gemini`; root, runtime, OpenAI, Anthropic,
and shared provider imports do not require the Google GenAI SDK. See
[Gemini runtime](gemini-runtime.md).

## AI SDK Bridge Subpath APIs

- `buildAiSdkTools(request)` exports Vercel AI SDK tools from a routed AICF
  capability slice.
- `createAiSdkToolFactoriesFromSdk(sdk)` wraps compatible host-owned AI SDK
  `tool`, `jsonSchema`, and optional `stepCountIs` factories.
- `createDefaultAiSdkToolFactories()` dynamically imports optional `ai`.
- `runAiSdkGenerateText(request)` calls a host-supplied `generateText` function
  with AICF-backed tools and returns a safe summary.
- `runAiSdkStreamText(request)` calls a host-supplied `streamText` function with
  AICF-backed tools and does not consume or log raw stream chunks.

The AI SDK bridge is isolated under
`ai-capability-framework/providers/ai-sdk`; root, runtime, OpenAI, Anthropic,
Gemini, and shared provider imports do not require the `ai` package or any AI
SDK provider package. See [AI SDK bridge](ai-sdk-runtime.md).

## LangChain Runtime Subpath APIs

- `buildLangChainTools(request)` exports LangChain tool objects from a routed
  AICF capability slice.
- `buildLangGraphToolNode(request)` wraps the generated tools in a
  host-supplied LangGraph `ToolNode` constructor.
- `createLangChainToolFactoryFromSdk(sdk)` wraps a compatible host-owned
  LangChain tool factory.
- `createDefaultLangChainToolFactory()` dynamically imports optional
  `@langchain/core/tools`.
- `createLangChainZodSchemaFactory(zod)` converts the supported AICF JSON
  Schema object subset into Zod schemas for LangChain tools.

The LangChain bridge is isolated under
`ai-capability-framework/providers/langchain`; root, runtime, OpenAI, Anthropic,
Gemini, AI SDK, and shared provider imports do not require LangChain or
provider-specific LangChain integrations. See
[LangChain bridge](langchain-runtime.md).

## Semantic Kernel Compatibility Subpath APIs

- `exportSemanticKernelOpenApiPlugin(request)` returns an OpenAPI 3.1 document
  for a host-owned AICF executor route.
- `exportSemanticKernelPluginMetadata(request)` returns plugin metadata with
  MCP recommendation, OpenAPI import hints, and function summaries.
- `getSemanticKernelMcpIntegrationGuide()` returns public-safe integration
  guidance for Semantic Kernel MCP plugin hosts.

The Semantic Kernel subpath is isolated under
`ai-capability-framework/providers/semantic-kernel`. It has no Semantic Kernel
dependency, does not call models, does not execute handlers, and does not expose
commit capabilities. MCP is the preferred path when available; OpenAPI export is
the fallback for hosts that already expose an AICF executor HTTP route. See
[Semantic Kernel compatibility](semantic-kernel-runtime.md).

## Schema Subpaths

The package exports stable schema subpaths, including:

```ts
import capabilitySchema from "ai-capability-framework/schemas/capability-manifest.schema.json";
```

Bundlers and runtimes may require JSON import assertions. The same files are
also included under `schemas/` in the npm package.

## CLI

```bash
aicf validate [path]
aicf inspect [path]
aicf decide <path> --request <decision.json>
aicf openai-tools <path> --context <context.json> [--include-restricted]
aicf anthropic-tools <path> --context <context.json> [--include-restricted]
aicf gemini-tools <path> --context <context.json> [--include-restricted]
aicf ai-sdk-tools <path> --context <context.json> [--include-restricted]
aicf mcp-tools <path> --context <context.json> [--include-restricted]
aicf langchain-tools <path> --context <context.json> [--include-restricted]
aicf semantic-kernel-functions <path> --context <context.json> [--include-restricted]
aicf eval <path> --results <results.json> [--format text|json]
aicf eval-live <path> --cases <cases.json> --model <model> [--format text|json]
aicf export promptfoo <path> --out <dir> [--provider <provider>] [--include-red-team-defaults]
```

Denied decisions exit `0` when the decision was evaluated successfully. Eval
runs exit `0` only when all targeted evals pass.

Adapter commands also accept `--include-deprecated`, `--include-draft`, and
`--include-experimental`. `--include-disabled-for-tests` is intentionally
reserved for test contexts.

## Versioning

The package version uses semver. Manifest schemas use `schema_version: "1.0"`.
The 1.0 validator intentionally does not support the pre-release 0.1 schema.
Changes to TypeScript exports, CLI output, or schema semantics must be covered
by tests before release. Public API or schema changes must also update
`CHANGELOG.md`, the migration notes when relevant, and the GitHub release notes
checklist in `docs/release.md`.
