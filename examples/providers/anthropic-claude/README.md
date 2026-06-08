# Anthropic Claude Provider Example

This example shows the public-safe shape for using AICF with Claude Messages tool use.

```bash
npm install ai-capability-framework @anthropic-ai/sdk
npm run build
npm run test:anthropic:mock
```

```ts
import { runAnthropicMessages } from "ai-capability-framework/providers/anthropic";
```

Host applications provide the Anthropic-compatible client, runtime context, handler
registry, executor, and model messages. AICF routes only read and prepare capabilities,
validates tool input against AICF schemas, returns model-safe envelopes, and never
exposes commit tools to Claude.

Live tests are opt-in only:

```bash
RUN_LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=... AICF_ANTHROPIC_MODEL=... npm run test:anthropic:live
```

Do not store raw Claude payloads, prompts, or tool outputs in public examples.
