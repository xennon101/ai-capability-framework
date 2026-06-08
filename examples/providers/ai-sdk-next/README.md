# Vercel AI SDK Provider Example

This example shows the public-safe shape for using AICF with Vercel AI SDK Core. The
host application selects and configures the model provider.

```bash
npm install ai-capability-framework ai
npm run build
npm run test:ai-sdk:mock
```

```ts
import {
  buildAiSdkTools,
  runAiSdkGenerateText
} from "ai-capability-framework/providers/ai-sdk";
```

AICF builds executor-backed AI SDK tools from a routed capability slice. Tool `execute`
callbacks delegate to AICF validation, policy, lifecycle, and runtime envelope handling.
Commit capabilities are not exposed.

Live tests are opt-in only and depend on host-supplied model setup:

```bash
RUN_LIVE_AI_SDK=1 npm run test:ai-sdk:live
```

Do not include provider-specific raw stream chunks, payloads, or transcripts in public
examples.
