# Anthropic Quickstart

Use this guide when your host app wants Claude Messages tools backed by AICF. The
default path uses mock clients and descriptor checks. Live calls are explicitly opt-in.

## Install

Core AICF does not require the Anthropic SDK:

```bash
npm install ai-capability-framework
```

Only apps that construct a default Claude client need the optional SDK:

```bash
npm install @anthropic-ai/sdk
```

Provider imports stay isolated:

```ts
import { runAnthropicMessages } from "ai-capability-framework/providers/anthropic";
```

## Mock-Tested Flow

Run the Anthropic mock runtime tests:

```bash
npm run test:anthropic:mock
```

Expected output excerpt:

```text
Test Files ... passed
```

The Anthropic adapter converts routed AICF read/prepare capabilities into Claude tool
definitions and maps `tool_use` blocks back through AICF bindings.

## Live Opt-In

Live tests are skipped unless you explicitly opt in:

```bash
RUN_LIVE_ANTHROPIC=1 ANTHROPIC_API_KEY=... AICF_ANTHROPIC_MODEL=claude-sonnet-4-5 \
  npm run test:anthropic:live
```

For live evals:

```bash
RUN_REAL_AICF_LIVE_EVALS=1 ANTHROPIC_API_KEY=... \
  node dist/cli.js eval-live examples --cases cases.json --provider anthropic --model claude-sonnet-4-5
```

AICF remains the validation, policy, lifecycle, approval, idempotency, and model-safe
envelope authority. Anthropic tool definitions are an adapter projection, not trusted
execution.
