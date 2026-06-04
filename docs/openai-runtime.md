# OpenAI Responses Runtime

The OpenAI Responses runtime is an optional subpath for host applications that
want AICF to run a bounded Responses tool loop. It builds runtime context,
routes model-safe read and prepare capabilities, calls a caller-provided OpenAI
Responses client, executes function calls through the R2 `AicfToolExecutor`,
returns model-safe tool envelopes, and produces final text.

Import it separately:

```ts
import {
  createDefaultOpenAIResponsesClient,
  runOpenAIResponses
} from "ai-capability-framework/openai";
```

The package root and `ai-capability-framework/runtime` imports do not import the
OpenAI runtime code.

For a first pass through the support/refund example, start with the
[OpenAI walkthrough](openai-walkthrough.md). This page is the runtime API
reference for host applications that want to provide a real OpenAI-compatible
client.

## Boundary

The runtime loop is non-streaming and Responses-only. It does not expose commit
tools to the model, execute side effects through model tool calls, persist
production state, collect approvals, write durable audit logs, add observability
systems, or require the OpenAI SDK for Core or runtime imports.

Host applications remain responsible for:

- providing a compatible OpenAI client or installing the optional `openai` SDK;
- enforcing real auth and account state;
- registering safe read and prepare handlers;
- storing approvals, prepared actions, idempotency, and audit data durably;
- committing side effects through host-controlled lifecycle APIs;
- deciding when to run live model tests.

## Client Setup

Pass any compatible client that exposes `responses.create()`:

```ts
const client = createOpenAIResponsesClientFromSdk(existingOpenAIClient);
```

Or install the optional SDK and let AICF create the client dynamically:

```bash
npm install openai
```

```ts
const client = await createDefaultOpenAIResponsesClient();
```

If the SDK is unavailable, `createDefaultOpenAIResponsesClient()` throws an
actionable optional-dependency error. This is the only API that attempts to
import `openai`.

## Running A Request

```ts
const result = await runOpenAIResponses({
  client,
  contextBuilder,
  executor,
  model: "gpt-4.1-mini",
  registry,
  router,
  runtimeContext,
  userInput: {
    text: "Read ticket TCK-100 and prepare a refund case if needed."
  }
});
```

Defaults:

- `maxTurns = 6`
- `maxToolCalls = 10`
- `parallel_tool_calls = false`
- streaming is out of scope

The runner builds context, routes capabilities, converts the routed slice into
OpenAI function tools, sends a non-streaming `responses.create` request, executes
returned `function_call` items through `AicfToolExecutor`, and continues with
`function_call_output` items. Tool output is serialized with runtime
model-safe envelope helpers.

If an OpenAI function call omits `call_id`, the runner fails safely rather than
guessing how to pair output. Unknown tool names and invalid arguments become
model-safe unavailable or validation-error envelopes. Provider failures return
`provider_error` without raw provider payloads.

## Result Shape

`AicfOpenAIRunResult` includes:

- `runId`
- `responseId`
- `status`
- `finalText`
- `selectedCapabilities`
- validated tool call summaries
- `toolResults`
- `usage`
- lightweight runtime events
- safe errors

Runtime events are summaries only. They must not be treated as trace storage and
do not include raw provider payloads, prompts, secrets, or diagnostics.

Pass `traceSink` and `contentCapture` to emit sanitized events to the optional
observability subpath:

```ts
const result = await runOpenAIResponses({
  ...request,
  contentCapture: "metadata",
  traceSink
});
```

See [observability runtime](observability-runtime.md) for trace sinks and
redaction behavior.

## Agents SDK Bridge

The OpenAI subpath also exports `buildAgentsSdkTools()` and
`createDefaultAgentsSdkBridgeFactory()` for host applications that already use
the OpenAI Agents SDK.

The bridge creates function-tool definitions backed by `AicfToolExecutor`. It
does not create an Agent, start an Agents SDK run, call a model, or make the
Agents SDK approval system the source of truth. Approval-required AICF prepare
results are returned as model-safe envelopes with prepared-action references.
Commit tools are not generated.

## Testing

Mock tests use `MockOpenAIResponsesClient`:

```ts
const client = new MockOpenAIResponsesClient([
  mockTextResponse("Done.")
]);
```

Run mock tests without API keys:

```bash
npm run test:openai:mock
```

The live smoke test is skipped unless all of these are set:

```bash
RUN_REAL_OPENAI=1
OPENAI_API_KEY=...
AICF_OPENAI_MODEL=...
```

Then run:

```bash
npm run test:openai:live
```

Live tests should stay harmless and synthetic. Do not store raw provider
payloads, traces, prompts, or customer data in the repository.

Live eval suites use this same runtime path with mock clients by default. See
[live evals](live-evals.md).

For a no-model runtime flow that uses the same context, router, executor, and
action lifecycle primitives, run:

```bash
npm run build
node examples/runtime-support-billing/run-mock.mjs
```

## Reference Basis

The runtime uses the Responses `responses.create` request shape and function
calling continuation pattern documented by OpenAI:

- [Responses create API](https://platform.openai.com/docs/api-reference/responses/create?api-mode=responses)
- [Function calling guide](https://platform.openai.com/docs/guides/function-calling?api-mode=responses)
