# Gemini Quickstart

Use this guide when your host app wants Google Gemini GenerateContent function calling
backed by AICF. The default path uses mock clients and descriptor checks. Live calls are
explicitly opt-in.

## Install

Core AICF does not require the Google GenAI SDK:

```bash
npm install ai-capability-framework
```

Only apps that construct a default Gemini client need the optional SDK:

```bash
npm install @google/genai
```

Provider imports stay isolated:

```ts
import { runGeminiGenerateContent } from "ai-capability-framework/providers/gemini";
```

## Mock-Tested Flow

Run the Gemini mock runtime tests:

```bash
npm run test:gemini:mock
```

Expected output excerpt:

```text
Test Files ... passed
```

The Gemini adapter converts routed AICF read/prepare capabilities into function
declarations and maps `functionCall` parts back through AICF bindings.

## Live Opt-In

Live tests are skipped unless you explicitly opt in:

```bash
RUN_LIVE_GEMINI=1 GEMINI_API_KEY=... AICF_GEMINI_MODEL=gemini-2.5-flash \
  npm run test:gemini:live
```

For live evals:

```bash
RUN_REAL_AICF_LIVE_EVALS=1 GEMINI_API_KEY=... \
  node dist/cli.js eval-live examples --cases cases.json --provider gemini --model gemini-2.5-flash
```

AICF remains the validation, policy, lifecycle, approval, idempotency, and model-safe
envelope authority. Gemini function declarations are an adapter projection, not the
source of truth.
