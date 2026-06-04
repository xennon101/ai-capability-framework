# Vercel AI SDK Bridge

The AI SDK bridge is an optional provider adapter for applications that already
use Vercel AI SDK Core. It translates a routed AICF capability slice into AI SDK
tools, executes tool calls through `AicfToolExecutor`, and returns model-safe
AICF runtime envelopes.

It does not install provider packages, choose a model provider, expose commit
tools, persist state, log raw provider payloads, or make root/runtime imports
depend on the `ai` package.

## Import

Install AICF plus AI SDK Core only in applications that use this bridge. Model
provider packages remain host application dependencies.

```bash
npm install ai-capability-framework ai
```

```ts
import {
  buildAiSdkTools,
  createDefaultAiSdkToolFactories,
  runAiSdkGenerateText
} from "ai-capability-framework/providers/ai-sdk";
```

`createDefaultAiSdkToolFactories()` dynamically imports the optional `ai`
package. Host applications may instead pass compatible `tool`, `jsonSchema`,
and optional `stepCountIs` factories.

## Tool Bridge

`buildAiSdkTools()` builds an AI SDK tool set from an already-routed AICF
capability slice. Each generated tool uses a provider-safe name, a cloned JSON
Schema input, and an `execute` callback that delegates to
`executeProviderToolCall()`.

AI SDK validation and `needsApproval` metadata are advisory. AICF still performs
canonical input validation, policy checks, lifecycle checks, approval handling,
and model-safe envelope formatting.

Minimal usage is: validate manifests, build a routed runtime slice, register
read/prepare handlers, create AI SDK tool factories, then pass the generated
tools to a host-owned `generateText` or `streamText` call.

## Generate And Stream Wrappers

`runAiSdkGenerateText()` is a convenience wrapper around a host-supplied
`generateText` function. It passes the host model, prompt or messages, system
text, tools, `stopWhen`, and provider options, then returns a safe summary with
text, tool-call summaries, model-safe tool envelopes, usage, warnings, and trace
events.

`runAiSdkStreamText()` is a thin wrapper around a host-supplied `streamText`
function. It passes AICF-backed tools and trace hooks, sets `includeRawChunks:
false`, and does not consume, transform, log, or store raw stream chunks.

## Boundary

- AICF capability manifests, policy, lifecycle, and runtime envelopes remain the
  source of truth.
- Commit, destructive, money-moving, and external-send capabilities are not
  exported by default and are not executable through AI SDK tool calls.
- Provider packages such as `@ai-sdk/openai`, `@ai-sdk/anthropic`, and
  `@ai-sdk/google` are host application dependencies, not AICF dependencies.
- Raw prompts, provider request/response payloads, traces, credentials, and
  private diagnostics are not captured by default.
- Live tests are opt-in with `RUN_LIVE_AI_SDK=1` and host-provided model setup.

Known limitations: no AI SDK provider packages, no provider selection, no UI
components, no raw stream chunk capture, no production storage, and no
model-exposed commit path.

## Checks

```bash
npm run build
npm run test:ai-sdk:mock
```

Live tests are skipped unless explicitly configured:

```bash
npm run test:ai-sdk:live
```
