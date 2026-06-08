# OpenAI Quickstart

Use this guide when your host app wants OpenAI Responses tools backed by AICF. The
default commands are mock or descriptor checks. Live calls are opt-in.

## Install

Core AICF does not require the OpenAI SDK:

```bash
npm install ai-capability-framework
```

Only apps that create a default OpenAI client need the optional SDK:

```bash
npm install openai
```

Root and runtime imports remain lightweight:

```ts
import { loadRegistryFromPath } from "ai-capability-framework";
import { runOpenAIResponses } from "ai-capability-framework/openai";
```

## Mock-Tested Flow

Run the existing mock runtime tests:

```bash
npm run test:openai:mock
```

Expected output excerpt:

```text
Test Files ... passed
```

The OpenAI runtime exports only routed read/prepare tools. Commit tools remain
host-controlled through AICF action lifecycle APIs.

## Live Opt-In

Live tests are skipped unless you explicitly opt in:

```bash
RUN_REAL_OPENAI=1 OPENAI_API_KEY=... AICF_OPENAI_MODEL=gpt-4.1-mini npm run test:openai:live
```

For live evals, the CLI has its own explicit guard:

```bash
RUN_REAL_AICF_LIVE_EVALS=1 OPENAI_API_KEY=... \
  node dist/cli.js eval-live examples --cases cases.json --provider openai --model gpt-4.1-mini
```

AICF remains the validation, policy, lifecycle, approval, idempotency, and model-safe
envelope authority. OpenAI tool schemas are an adapter projection, not the source of
truth.
