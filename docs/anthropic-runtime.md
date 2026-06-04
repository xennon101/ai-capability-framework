# Anthropic Claude Runtime

The Anthropic runtime is an optional provider adapter for Claude Messages tool
use. It translates a routed AICF capability slice into Claude client tools,
runs a bounded Messages loop with a caller-provided client, executes tool calls
through `AicfToolExecutor`, and returns Claude-compatible `tool_result` blocks.

It does not expose commit tools, use Anthropic Tool Runner, persist state, log
raw provider payloads, or make root/runtime imports depend on the Anthropic SDK.

## Import

Install AICF plus the optional Anthropic SDK only in applications that use this
subpath:

```bash
npm install ai-capability-framework @anthropic-ai/sdk
```

```ts
import {
  buildAnthropicTools,
  createDefaultAnthropicMessagesClient,
  runAnthropicMessages
} from "ai-capability-framework/providers/anthropic";
```

`createDefaultAnthropicMessagesClient()` dynamically imports the optional
`@anthropic-ai/sdk` package. Host applications may instead pass any compatible
client with `messages.create(input)`.

## Runtime Shape

Minimal usage is: validate manifests, build a routed runtime slice, register
read/prepare handlers, create or pass a Claude-compatible client, then call
`runAnthropicMessages()` with synthetic-safe messages and host context.

The host application is responsible for building runtime context, routing
capabilities, registering handlers, and providing initial Claude messages.

`runAnthropicMessages()` sends `model`, `max_tokens`, `system`, `messages`,
`tools`, and optional `tool_choice` to `client.messages.create()`. If Claude
returns `tool_use` blocks, AICF parses them through the generated binding map,
validates arguments against the original AICF schema, executes only read or
prepare through the runtime executor, and appends one user message whose content
starts with matching `tool_result` blocks.

`tool_result.tool_use_id` always comes from Claude's `tool_use.id`. Safe error
envelopes set `is_error: true`; approval-required prepare results are returned
as model-safe envelopes without committing the action.

## Boundary

The Anthropic runtime follows the same provider-neutral boundary as the OpenAI
runtime:

- AICF capability manifests, policy, lifecycle, and runtime envelopes remain the
  source of truth.
- Claude tool schemas are provider descriptors, not trusted execution policy.
- Commit, destructive, money-moving, and external-send capabilities are not
  exported by default and are not executable through provider tool calls.
- Raw prompts, provider request/response payloads, traces, credentials, and
  private diagnostics are not captured by default.
- Live tests are opt-in with `RUN_LIVE_ANTHROPIC=1`, `ANTHROPIC_API_KEY`, and
  `AICF_ANTHROPIC_MODEL`.

Known limitations: no streaming, no Anthropic Tool Runner, no server-side
Anthropic tools, no provider-managed automatic tool execution, no production
storage, and no model-exposed commit path.

## Checks

```bash
npm run build
npm run test:anthropic:mock
```

Live tests are skipped unless explicitly configured:

```bash
npm run test:anthropic:live
```
