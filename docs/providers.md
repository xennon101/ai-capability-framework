# Provider Foundation

AICF is a provider-agnostic AI capability framework. It turns application
functions, data access, and workflows into typed, permissioned, versioned,
observable, and evaluated capabilities that can be exposed to AI models and
agent frameworks without making any provider schema the source of truth.

OpenAI is one adapter, not the architecture. The canonical contract is still
the AICF capability manifest plus runtime policy, lifecycle, and model-safe
result envelopes.

## Provider Types

- Direct model runtimes: OpenAI Responses, Anthropic Claude Messages, and Google
  Gemini GenerateContent.
- Framework bridges: Vercel AI SDK and LangChain/LangGraph.
- Interoperability surfaces: MCP descriptors/server runtime and Semantic
  Kernel-compatible MCP/OpenAPI metadata.
- Descriptor-only conformance: the provider conformance matrix verifies that a
  routed slice maps consistently across supported targets.

Provider modules are optional subpath imports. Root, runtime, and shared
provider imports must work without Anthropic, Google, AI SDK, LangChain, MCP SDK,
Semantic Kernel, OpenAI, AWS, or observability SDK packages installed.

```ts
import { createProviderToolNameMap } from "ai-capability-framework/providers";
import { runAnthropicMessages } from "ai-capability-framework/providers/anthropic";
import { runGeminiGenerateContent } from "ai-capability-framework/providers/gemini";
import { buildAiSdkTools } from "ai-capability-framework/providers/ai-sdk";
import { buildLangChainTools } from "ai-capability-framework/providers/langchain";
import { buildMcpProviderToolDescriptors } from "ai-capability-framework/providers/mcp";
import { exportSemanticKernelOpenApiPlugin } from "ai-capability-framework/providers/semantic-kernel";
```

## Shared Behavior

The shared provider layer provides deterministic provider-safe tool names,
collision diagnostics, reverse lookup through binding maps, schema
normalization, canonical provider call/result summaries, optional dependency
loading, and an execution helper that delegates read and prepare calls to
`AicfToolExecutor`.

Provider SDK validation does not replace AICF validation. Provider descriptors
are generated from routed AICF capability slices, then all tool calls map back
through bindings to the original capability ID and input schema.

## Safety Boundary

AICF remains the policy and action authority:

- commit capabilities are not exported to models by default;
- read and prepare calls execute through AICF validation, policy, lifecycle, and
  model-safe envelopes;
- commit remains host-controlled through `AicfActionLifecycleManager` after a
  stored prepared action, approval, idempotency, and audit checks;
- raw prompts, raw user messages, provider request/response payloads, traces,
  credentials, and private diagnostics are not logged by default;
- ambiguous provider/runtime behavior fails closed.

Live tests are opt-in. Normal package checks use mock clients, fake SDK
factories, descriptor exports, and synthetic fixtures.

## Guides And Examples

- [OpenAI Responses runtime](openai-runtime.md)
- [Anthropic Claude runtime](anthropic-runtime.md)
- [Google Gemini runtime](gemini-runtime.md)
- [Vercel AI SDK bridge](ai-sdk-runtime.md)
- [LangChain/LangGraph bridge](langchain-runtime.md)
- [MCP server runtime](mcp-server-runtime.md)
- [Semantic Kernel compatibility](semantic-kernel-runtime.md)
- [Provider conformance](provider-conformance.md)

Grouped public examples live under `examples/providers/`. They are README-only
by design: no credentials, raw provider payloads, live transcripts, or local
runtime state are included.

## Release Checks

```bash
npm run check:providers:mock
npm run check:release:providers
```

Use live provider checks only when explicitly configured:

```bash
npm run check:providers:live
```
