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
import {
  loadManifests,
  validateManifests,
  buildRegistry
} from "ai-capability-framework";
import { runOpenAIResponses } from "ai-capability-framework/openai";
```

Load and validate your manifests with `loadManifests` and `validateManifests`, then pass
them to `buildRegistry`; the [complete quickstart](provider-neutral-quickstart.md) shows
runnable code.

## Mock-Tested Flow

Run the installed no-key customer flow:

```bash
node node_modules/ai-capability-framework/examples/12-capability-discovery-selection/run-customer-mock.mjs
```

Expected output excerpt:

```text
"ordinaryModelTurns": 4
```

The OpenAI runtime exports only routed read/prepare tools. Commit tools remain
host-controlled through AICF action lifecycle APIs.

## Repository development and live opt-in

The commands below are for an optional [framework source checkout](../development.md).
Normal package consumers supply their own configured client and explicit model.

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
