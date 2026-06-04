# LangChain And LangGraph Bridge

The LangChain bridge is an optional provider adapter for applications that
already use LangChain.js or LangGraph.js. It translates a routed AICF capability
slice into LangChain tools, executes tool calls through `AicfToolExecutor`, and
returns serialized model-safe AICF runtime envelopes.

It does not install model provider integrations, choose a chat model, expose
commit tools, persist state, log raw provider payloads, or make root/runtime
imports depend on LangChain.

## Import

Install AICF plus LangChain packages only in applications that use this bridge.
Provider-specific LangChain integrations remain host dependencies.

```bash
npm install ai-capability-framework @langchain/core langchain zod
```

```ts
import {
  buildLangChainTools,
  buildLangGraphToolNode,
  createDefaultLangChainToolFactory
} from "ai-capability-framework/providers/langchain";
```

`createDefaultLangChainToolFactory()` dynamically imports the optional
`@langchain/core/tools` package. Host applications may instead pass a
compatible `tool` factory.

## Tool Bridge

`buildLangChainTools()` builds a normal LangChain tool array from an
already-routed AICF capability slice. Each generated tool uses a provider-safe
name, model-safe description, schema, and function that delegates to
`executeProviderToolCall()`.

LangChain schema validation is advisory. AICF still performs canonical input
validation, policy checks, lifecycle checks, approval handling, and model-safe
envelope formatting.

Minimal usage is: validate manifests, build a routed runtime slice, register
read/prepare handlers, create or pass a LangChain tool factory, then give the
generated tools to the host-owned agent or graph.

## LangGraph ToolNode

`buildLangGraphToolNode()` is a thin wrapper around a host-supplied `ToolNode`
constructor. AICF does not import `@langchain/langgraph` by default. The helper
creates the same AICF-backed tools and passes them to the supplied constructor.

## Boundary

- AICF capability manifests, policy, lifecycle, and runtime envelopes remain the
  source of truth.
- Commit, destructive, money-moving, and external-send capabilities are not
  exported by default and are not executable through LangChain tool calls.
- Provider packages such as `@langchain/openai`, `@langchain/anthropic`, and
  `@langchain/google-genai` are host application dependencies, not AICF
  dependencies.
- Raw prompts, provider request/response payloads, traces, credentials, and
  private diagnostics are not captured by default.
- Live tests are opt-in with `RUN_LIVE_LANGCHAIN=1` and may use fake
  LangChain-compatible tools instead of a real provider model.

Known limitations: no provider-specific LangChain integrations, no model
selection, no production storage, no automatic approval UI, and no model-exposed
commit path.

## Checks

```bash
npm run build
npm run test:langchain:mock
```

Live tests are skipped unless explicitly configured:

```bash
npm run test:langchain:live
```
