# Cross-Provider Conformance

AICF conformance checks prove that one routed capability slice can be exported
consistently across provider and framework targets. The canonical import path is
`ai-capability-framework/conformance`.

The conformance harness is descriptor/mock-only. It does not call live models,
use credentials, execute provider SDKs, store provider payloads, or expose
commit capabilities to models.

## Install And Import

```bash
npm install ai-capability-framework
```

```ts
import {
  listConformanceTargets,
  runConformanceSuite,
  buildConformanceMatrix
} from "ai-capability-framework/conformance";
```

The older `ai-capability-framework/providers/conformance` path remains available
as a compatibility alias.

## Targets

The canonical matrix covers:

- OpenAI Responses;
- Anthropic Claude;
- Google Gemini;
- Vercel AI SDK (`ai-sdk`);
- LangChain/LangGraph;
- Model Context Protocol;
- Semantic Kernel through MCP compatibility;
- Semantic Kernel through OpenAPI plugin metadata.

`semantic-kernel` is accepted as an alias for `semantic-kernel-openapi`.
`vercel-ai-sdk` and `vercel_ai_sdk` are accepted as aliases for `ai-sdk`.

## What Gets Checked

The report scores each target across these dimensions:

- descriptor export;
- tool-name mapping and reversible bindings;
- schema normalization and schema downgrade diagnostics;
- tool-call parsing and argument validation;
- model-safe result envelopes;
- approval-required behavior;
- commit-not-exported behavior;
- risk and disabled-status filtering;
- provider error normalization;
- loop or streaming boundary metadata.

Failures are structured by provider, capability, case, and dimension. The report
also keeps the older `passed`, `counts`, and `results` fields for existing
callers.

## CLI

```bash
aicf conformance run examples --format text
aicf conformance run examples --providers openai,anthropic,mcp --format json
aicf conformance matrix examples --format markdown
```

Write output to a file with `--out`:

```bash
aicf conformance run examples --format json --out conformance-report.json
aicf conformance matrix examples --format markdown --out conformance-matrix.md
```

Compatibility aliases remain:

```bash
aicf providers list
aicf providers conformance examples --format text
```

## Boundary

Host applications remain responsible for model calls, provider SDK setup,
runtime context, real authorization, approval collection, idempotency, side
effects, audit persistence, and optional live tests.

Conformance uses public manifests, synthetic contexts, and mock/canonical calls.
Live provider behavior belongs in provider-specific opt-in tests.

## Checks

```bash
npm run build
npm run test:conformance
npm run test:providers:conformance
npm run check:providers:mock
```
