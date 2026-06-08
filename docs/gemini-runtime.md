# Google Gemini Runtime

The Gemini runtime is an optional provider adapter for GenerateContent function calling.
It translates a routed AICF capability slice into Gemini function declarations, runs a
bounded `models.generateContent` loop with a caller-provided client, executes function
calls through `AicfToolExecutor`, and returns Gemini-compatible `functionResponse`
parts.

It does not expose commit tools, enable Gemini built-in tools, use automatic
provider-side execution, persist state, log raw provider payloads, or make root/runtime
imports depend on the Google GenAI SDK.

## Import

Install AICF plus the optional Google GenAI SDK only in applications that use this
subpath:

```bash
npm install ai-capability-framework @google/genai
```

```ts
import {
  buildGeminiFunctionDeclarations,
  createDefaultGeminiClient,
  runGeminiGenerateContent
} from "ai-capability-framework/providers/gemini";
```

`createDefaultGeminiClient()` dynamically imports the optional `@google/genai` package.
Host applications may instead pass any compatible client with
`models.generateContent(input)`.

## Runtime Shape

Minimal usage is: validate manifests, build a routed runtime slice, register
read/prepare handlers, create or pass a Gemini-compatible client, then call
`runGeminiGenerateContent()` with host-owned contents and runtime context.

The host application is responsible for building runtime context, routing capabilities,
registering handlers, and providing initial Gemini contents.

`runGeminiGenerateContent()` sends `model`, `contents`, and `config` to
`client.models.generateContent()`. AICF places routed read/prepare capabilities under
`config.tools: [{ functionDeclarations }]` and can pass optional
`toolConfig.functionCallingConfig.mode` plus `allowedFunctionNames`.

When Gemini returns function calls, AICF parses both `response.functionCalls` and
candidate content parts. Calls are mapped through the generated binding map, arguments
are validated against the original AICF schema, and only read or prepare execution is
delegated to the runtime executor.

Tool results are appended as user content parts shaped as
`{ functionResponse: { id, name, response: { result } } }`. The `id` is preserved when
Gemini provides one. Approval-required prepare results are returned as model-safe
envelopes without committing the action.

## Boundary

The Gemini runtime follows the same provider-neutral boundary as the OpenAI and
Anthropic runtimes:

- AICF capability manifests, policy, lifecycle, and runtime envelopes remain the source
  of truth.
- Gemini function declarations are provider descriptors, not trusted execution policy.
- Commit, destructive, money-moving, and external-send capabilities are not exported by
  default and are not executable through provider tool calls.
- Raw prompts, provider request/response payloads, traces, credentials, and private
  diagnostics are not captured by default.
- Live tests are opt-in with `RUN_LIVE_GEMINI=1`, `GEMINI_API_KEY`, and
  `AICF_GEMINI_MODEL`.

Known limitations: no streaming, no Gemini built-in tools, no automatic provider-side
function execution, no production storage, and no model-exposed commit path.

## Checks

```bash
npm run build
npm run test:gemini:mock
```

Live tests are skipped unless explicitly configured:

```bash
npm run test:gemini:live
```
