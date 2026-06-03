# API

AICF exposes a small TypeScript API and the `aicf` CLI. The package is public
npm release-candidate material, and the exported surface is treated as public
developer API.

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

The library does not call models, execute capabilities, verify host
authorization, persist actions, collect approvals, write audit logs, or perform
side effects. Host applications own runtime execution and storage.

## Core Manifest APIs

- `loadManifests(options)` reads YAML and JSON manifests from convention paths.
- `validateManifests(manifests, options)` validates schemas, duplicate IDs, and
  manifest cross-references.
- `buildRegistry(manifests)` returns lookup maps and grouped manifest arrays.
- `inspectRegistry(registry)` returns counts, capability groupings, eval
  coverage, and warnings.

Diagnostics use `AicfDiagnostic` with `code`, `path`, optional `kind`, optional
`id`, and a human-readable `message`.

## Decision APIs

- `decideCapability(registry, request)` evaluates select, prepare, or commit
  status for one capability.
- `evaluatePolicy(capability, request)` evaluates deterministic policy metadata.
- `evaluateLifecycle(capability, request)` evaluates lifecycle availability.

Decision results return `status`, `reasons`, `requiredApprovals`, `policy`,
`lifecycle`, and an audit preview. The audit preview is not persisted.

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

## Eval Runner APIs

- `loadEvalResults(path)` reads and validates a public-safe eval result fixture.
- `scoreEvalCase(evalCase, candidate, registry)` scores one eval/candidate pair.
- `runEvalSuite(registry, candidates, options)` scores loaded eval manifests
  against candidate results.
- `formatEvalSuiteResult(result)` formats a readable text summary.

Eval runner output includes suite status, per-eval status, scorer results, and
diagnostics. It scores summarized behavior only, not raw model traces.

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
```

Denied decisions exit `0` when the decision was evaluated successfully. Eval
runs exit `0` only when all targeted evals pass.

## Versioning

The package version uses semver. Manifest schemas use `schema_version: "1.0"`.
The 1.0 validator intentionally does not support the pre-release 0.1 schema.
Changes to TypeScript exports, CLI output, or schema semantics must be covered
by tests before release. Public API or schema changes must also update
`CHANGELOG.md`, the migration notes when relevant, and the GitHub release notes
checklist in `docs/release.md`.
