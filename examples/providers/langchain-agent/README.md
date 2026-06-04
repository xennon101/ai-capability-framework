# LangChain Agent Provider Example

This example shows the public-safe shape for exposing AICF capabilities as
LangChain.js tools.

```bash
npm install ai-capability-framework @langchain/core langchain zod
npm run build
npm run test:langchain:mock
```

```ts
import { buildLangChainTools } from "ai-capability-framework/providers/langchain";
```

Host applications provide the LangChain model, agent loop, runtime context, and
handlers. AICF-backed tools execute only read and prepare operations through
`AicfToolExecutor` and return serialized model-safe envelopes.

Live tests are opt-in only:

```bash
RUN_LIVE_LANGCHAIN=1 npm run test:langchain:live
```

Do not commit raw LangChain traces, prompts, tool payloads, or provider
transcripts.
