# Google Gemini Provider Example

This example shows the public-safe shape for using AICF with Gemini
GenerateContent function calling.

```bash
npm install ai-capability-framework @google/genai
npm run build
npm run test:gemini:mock
```

```ts
import { runGeminiGenerateContent } from "ai-capability-framework/providers/gemini";
```

Host applications provide the Gemini-compatible client, runtime context,
handler registry, executor, and contents. AICF exports only routed read and
prepare function declarations, validates function arguments against canonical
AICF schemas, and returns model-safe function response envelopes.

Live tests are opt-in only:

```bash
RUN_LIVE_GEMINI=1 GEMINI_API_KEY=... AICF_GEMINI_MODEL=... npm run test:gemini:live
```

Do not commit raw Gemini payloads, prompts, or generated transcripts.
