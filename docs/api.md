# API

AICF Core exposes a small TypeScript API and the `aicf` CLI. The package is
public npm release-candidate material, and the exported surface is treated as
public developer API.

If you are reading AICF for the first time, start with
[Start here](start-here.md) and the [OpenAI walkthrough](openai-walkthrough.md).
This page is the reference once the basic flow is familiar.

Recommended path:

1. [Installation](getting-started/installation.md)
2. [Quickstart](getting-started/quickstart.md)
3. [Concepts](getting-started/concepts.md)
4. [Capability manifests](core/capability-manifests.md)
5. [Runtime overview](runtime/runtime-overview.md)
6. [Providers](providers.md)
7. [Evals](evals/overview.md)
8. [Governance](governance/overview.md) and [security](security/overview.md)
9. [Release process](public-framework/release-process.md)

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

Governance analysis utilities are available from:

```ts
import { compileCapabilityRisk } from "ai-capability-framework/governance";
```

The governance subpath evaluates lifecycle transitions, inferred risk,
compatibility diffs, and registry impact. It does not mutate manifests, execute
handlers, call models, or replace a host policy engine.

Canonical audit ledger contracts are available from:

```ts
import { DefaultAuditLedger } from "ai-capability-framework/audit";
```

The audit subpath provides public-safe ledger record constructors, redaction and
hash helpers, store interfaces, in-memory reference stores, and an optional
runtime recorder. It does not store raw prompts, provider payloads, stack
traces, secrets, or unredacted user/account/tenant IDs.

Trust, taint, redaction, and retention helpers are available from:

```ts
import { redactForProvider } from "ai-capability-framework/security";
```

The security subpath labels context segments, preserves public-safe provenance,
keeps untrusted data separate from instructions, applies provider/trace
redaction policies, and evaluates conservative retention defaults. It does not
replace host DLP, privacy review, or retention infrastructure.

Governed memory helpers are available from:

```ts
import { selectGovernedMemory } from "ai-capability-framework/memory";
```

The memory subpath validates host-owned memory summaries, decides whether they
may become model context for a specific use case, and converts selected records
to security/runtime context. It does not store, recall, infer, or update memory.

Capability-aware security test packs are available from:

```ts
import { generateSecurityCases } from "ai-capability-framework/security-packs";
```

The security-packs subpath lists built-in risk packs, generates public-safe
security cases, assesses pack coverage, and exports API-key-free Promptfoo
red-team config templates. It does not run Promptfoo, call models, claim
certification, or replace a host security review. See
[capability-aware security packs](security/security-packs.md).

Runtime kill switches, circuit breakers, and budgets are available from:

```ts
import { DefaultControlsEvaluator } from "ai-capability-framework/controls";
```

The controls subpath evaluates optional runtime controls for capability export,
routing, tool execution, lifecycle commit, and provider loops. It includes
in-memory and local JSON reference stores only; host applications own production
control storage, operator auth, incident workflows, and rollout policy.

The optional governance control plane is available from:

```ts
import { createControlPlaneService } from "ai-capability-framework/control-plane";
```

The control-plane subpath provides a framework-neutral request router, service
helpers, in-memory/file-backed reference stores, safe evidence export, and a
local example UI for reviewing capabilities, governance status, ledgers,
approvals, controls, and redacted replay metadata. It does not provide
production auth, production storage, hosted SaaS behavior, model calls, provider
SDK execution, or side-effect execution.

Compliance evidence export is available from:

```ts
import { createEvidencePack } from "ai-capability-framework/evidence";
```

The evidence subpath creates public-safe JSON or Markdown evidence packs from
manifests and optional supplied reports. It records missing coverage as gaps and
includes required disclaimers. It does not certify compliance, call providers,
store evidence, or include raw prompts, provider payloads, secrets, stack
traces, or unredacted IDs. See [evidence export](evidence.md).

Generated-content provenance hooks are available from:

```ts
import { createGeneratedContentProvenance } from "ai-capability-framework/provenance";
```

The provenance subpath creates refs-and-hashes metadata for customer-facing
generated content and passes validated metadata to host-supplied adapter hooks.
It does not implement C2PA signing, process documents or media, call providers,
store records, or include raw prompts, provider payloads, transcripts, secrets,
stack traces, or unredacted IDs. See [content provenance hooks](provenance.md).

Runtime replay and trace-to-golden helpers are available from:

```ts
import { runReplay, createGoldenFromTrace } from "ai-capability-framework/replay";
```

The replay subpath validates sanitized replay traces, runs deterministic replay
modes, and drafts review-required eval cases. It does not store raw prompts,
raw provider payloads, raw traces, credentials, or private diagnostics, and it
does not call live providers unless the host supplies an explicit live runner.

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
import { exportBraintrustDataset } from "ai-capability-framework/evalops";
import { exportPromptfooSuite } from "ai-capability-framework/promptfoo";
```

AWS reference integrations are isolated in their own optional subpath:

```ts
import {
  DynamoDbControlPlaneStore,
  DynamoDbPolicyDecisionStore,
  StepFunctionsApprovalAdapter
} from "ai-capability-framework/aws";
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
- `DefaultControlsEvaluator` can be supplied to routing, executor, lifecycle,
  and provider runtime calls to deny, force approval, apply read-only mode, or
  enforce per-run budgets.
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

## Governance Subpath APIs

Governance imports are intentionally separate from the Core root API:

```ts
import {
  analyzeCapabilityImpact,
  compareCapabilityVersions,
  compileCapabilityRisk,
  evaluateLifecycleTransition,
  formatGovernanceGateReport,
  loadGovernanceGateConfig,
  runGovernanceGate
} from "ai-capability-framework/governance";
```

- `compileCapabilityRisk(capability, options?)` compares declared risk with an
  inferred minimum and reports required controls.
- `evaluateLifecycleTransition(registry, request, context?)` returns an
  allow/block decision for draft, review, approved, canary, production,
  deprecated, disabled, and removed governance statuses.
- `compareCapabilityVersions(before, after)` classifies manifest changes as
  compatible, minor-required, or breaking.
- `analyzeCapabilityImpact(registry, capabilityId, options?)` reports directly
  affected capabilities, entities, evals, providers, policy references, and
  coverage gaps.
- `loadGovernanceGateConfig(pathOrRoot, options?)` loads `aicf.config.yaml` or
  JSON config with safe defaults when no config exists.
- `runGovernanceGate(input)` coordinates validation, semantic invariants, risk,
  lifecycle, optional compatibility baselines, impact, eval coverage,
  security-pack coverage, configured provider conformance, and artifact hygiene.
- `formatGovernanceGateReport(report, format)` formats gate results for CLI or
  CI logs.

The CLI equivalents live under `aicf governance ...` and `aicf gate ...`. See
[governance](governance/index.md) and [governance gate](governance/gate.md).

## Audit Subpath APIs

Audit imports are intentionally separate from the Core root API:

```ts
import {
  DefaultAuditLedger,
  createActionRecord,
  createPolicyDecisionRecord,
  hashAuditValue
} from "ai-capability-framework/audit";
```

- `createPolicyDecisionRecord(input)` creates a schema-valid decision evidence
  record with hashed inputs and redacted subject/account/tenant refs.
- `createActionRecord(input)`, `createApprovalRecord(input)`, and
  `createIdempotencyRecord(input)` create the corresponding canonical records.
- `InMemoryPolicyDecisionStore`, `InMemoryActionStore`,
  `InMemoryApprovalLedgerStore`, and `InMemoryIdempotencyLedgerStore` are
  reference stores for tests and examples only.
- `DefaultAuditLedger` composes the stores and implements the optional
  `AicfRuntimeLedgerRecorder` used by the runtime executor and lifecycle
  manager.

The schemas live under `schemas/audit/`. See [audit ledger](audit/index.md).

## Security Subpath APIs

Security imports are intentionally separate from the Core root API:

```ts
import {
  createContextSegment,
  createSourceRef,
  defaultRetentionPolicy,
  defaultSecurityRedactionPolicy,
  markTainted,
  redactForProvider,
  redactForTrace,
  validateContextSegment
} from "ai-capability-framework/security";
```

- `createContextSegment(input)` creates labelled context for provider and trace
  boundaries.
- `validateContextSegment(segment)` rejects untrusted segments that try to carry
  instructions.
- `markTainted(segment)` and `mergeTaint(left, right)` preserve the fact that
  content is not trusted tool input until validated by the host.
- `redactForProvider(value, context, policy?)` and
  `redactForTrace(value, context, policy?)` apply redaction policy.
- `defaultRetentionPolicy()` and `evaluateRetentionPolicy(policy, context)`
  enforce conservative raw-content defaults.

The schemas live under `schemas/security/`. See
[trust, taint, redaction, and retention](security/trust-taint-redaction.md).

## Memory Subpath APIs

Memory imports are intentionally separate from the Core root API:

```ts
import {
  evaluateMemoryExposure,
  memoryRecordToContextSegment,
  memoryRecordToRuntimeContextItem,
  selectGovernedMemory,
  validateGovernedMemoryRecord
} from "ai-capability-framework/memory";
```

- `validateGovernedMemoryRecord(record)` checks the public memory contract.
- `evaluateMemoryExposure(record, context)` returns allow/deny reasons for a
  specific exact use case and runtime scope.
- `selectGovernedMemory(records, context)` filters and deterministically sorts
  allowed records.
- `memoryRecordToContextSegment(record)` returns a security `ContextSegment`
  with `instructionsAllowed: false`.
- `memoryRecordToRuntimeContextItem(record)` returns a model-context item for a
  host runtime builder.

The schemas live under `schemas/memory/`. See
[governed memory and preferences](memory.md).

## Controls Subpath APIs

Controls imports are intentionally separate from the Core root API:

```ts
import {
  DefaultControlsEvaluator,
  InMemoryControlsStore,
  evaluateBudget
} from "ai-capability-framework/controls";
```

- `DefaultControlsEvaluator` evaluates kill switches, circuit breaker state, and
  budgets.
- `InMemoryControlsStore` and `LocalJsonControlsStore` are reference/local
  utilities, not production stores.
- `evaluateKillSwitches`, `evaluateCircuitBreakers`, and `evaluateBudget` are
  pure helpers for tests and host integration.

The schemas live under `schemas/controls/`. See [runtime controls](controls/index.md).

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
- `NoopTracer`, `InMemoryTracer`, `TraceSinkTracer`, and
  `OpenTelemetryTracerAdapter` provide run/span-style observability over the
  same safe event model.
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
- `exportBraintrustDataset()`, `importBraintrustResults()`,
  `exportOpenAIEvalDataset()`, and `importOpenAIEvalResults()` live in
  `ai-capability-framework/evalops` and transform public-safe eval data only.

These APIs are optional and do not make root imports depend on OpenTelemetry,
Langfuse, Promptfoo, or live model calls. See
[observability runtime](observability-runtime.md), [live evals](live-evals.md),
and [EvalOps](evalops.md).

## AWS Reference APIs

The AWS subpath is importable without AWS SDK packages installed. Store,
approval-adapter, and publisher operations require the relevant optional AWS SDK
peer dependency when used.

- `DynamoDbPreparedActionStore`, `DynamoDbApprovalStore`,
  `DynamoDbIdempotencyStore`, and `DynamoDbAuditSink` implement the runtime
  store/sink interfaces with caller-provided DynamoDB document clients.
- `DynamoDbPolicyDecisionStore`, `DynamoDbActionStore`,
  `DynamoDbApprovalLedgerStore`, and `DynamoDbIdempotencyLedgerStore`
  implement canonical audit ledger stores.
- `DynamoDbControlsStore`, `DynamoDbBudgetUsageStore`,
  `DynamoDbReplayTraceMetadataStore`, and `DynamoDbControlPlaneStore` provide
  AWS-backed controls and control-plane state.
- `StepFunctionsApprovalAdapter` starts and resumes host-owned approval
  workflows with safe prepared-action summaries.
- `EventBridgeRuntimeEventPublisher` publishes sanitized AICF trace or audit
  events to EventBridge.
- `CloudWatchTelemetryPublisher` and `KmsRedactionProvider` provide sanitized
  AWS telemetry and deterministic redaction refs.
- `FakeDynamoDbDocumentClient`, `FakeStepFunctionsClient`, and
  `FakeEventBridgeClient` plus CloudWatch, CloudWatch Logs, and KMS fakes
  support API-key-free tests.

These adapters do not provision AWS infrastructure, own approval UI, call
models, or expose commit to model tool execution. See
[AWS runtime](aws-runtime.md) and
[AWS production reference](aws/production-reference.md).

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

- `listConformanceTargets()` returns supported provider and bridge targets.
- `exportConformanceProviderTools(input)` exports descriptor JSON for a target
  from a selected AICF capability slice.
- `runConformanceSuite(input)` runs deterministic mock conformance cases and
  returns the canonical F7 report shape.
- `buildConformanceMatrix(input)` returns the canonical target matrix.
- `formatConformanceReport(report, format)` and
  `formatConformanceMatrix(matrix, format)` format CLI-ready output.
- `listProviderTargets()` returns supported provider and bridge targets.
- `exportProviderTools(input)` exports descriptor JSON for a target from a
  selected AICF capability slice.
- `runProviderConformanceSuite(input)` runs deterministic mock conformance
  cases.
- `formatProviderConformanceReport(report, format)` formats conformance output.

Use `ai-capability-framework/conformance` for new code. The older
`ai-capability-framework/providers/conformance` subpath remains a compatibility
alias. Both are descriptor/mock-only and do not call live providers. See
[cross-provider conformance](providers/conformance.md).

CLI commands:

```bash
aicf conformance run examples --format json
aicf conformance matrix examples --format markdown
aicf providers conformance examples --format text
```

API changes for manifests using `schema_version: "0.1"` should be reflected in
the changelog and release notes before a release tag is created.

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

## Evidence Subpath APIs

```ts
import {
  createEvidencePack,
  exportEvidencePack,
  formatEvidencePackMarkdown,
  validateEvidencePack
} from "ai-capability-framework/evidence";
```

- `createEvidencePack(input)` summarizes manifests and optional supplied
  governance/eval/security/conformance/control-plane reports.
- `exportEvidencePack(input, format)` returns JSON or Markdown content plus the
  pack object.
- `formatEvidencePackMarkdown(pack)` renders review-friendly Markdown.
- `validateEvidencePack(pack)` checks the public evidence schema.

Evidence packs are review summaries with required disclaimers and explicit
coverage gaps. They are not certification, audit opinions, legal opinions,
security guarantees, or compliance attestations.

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
aicf security list-packs [--format text|json]
aicf security generate <path> --pack <id> --out <file> [--format yaml|json]
aicf security export-promptfoo <path> --out <file> [--provider <provider>] [--pack <id>]
aicf gate <manifest-root> --env <name> [--config <file>] [--baseline <path>] [--format text|json]
aicf evidence export <manifest-root> --out <file> [--format json|markdown]
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

Final release readiness uses repository scripts rather than TypeScript APIs:
`npm run check`, `npm run check:public`, and `npm run check:certification`.
The final gate is documented in
[Final v1 certification](public-framework/v1-certification.md).
