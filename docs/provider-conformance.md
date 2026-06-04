# Provider Conformance

Provider conformance checks verify that the same routed AICF capability slice is
exported consistently across supported provider and framework targets.

The conformance harness is descriptor/mock-only. It does not call live models,
use provider credentials, execute provider SDK loops, persist payloads, or expose
commit capabilities to models.

## Import

Install AICF only; conformance uses descriptor exports and synthetic fixtures by
default.

```bash
npm install ai-capability-framework
```

```ts
import {
  listProviderTargets,
  exportProviderTools,
  runProviderConformanceSuite
} from "ai-capability-framework/providers/conformance";
```

## Targets

The current matrix covers:

- OpenAI Responses;
- Anthropic Claude;
- Google Gemini;
- Vercel AI SDK;
- LangChain/LangGraph;
- Model Context Protocol;
- Semantic Kernel OpenAPI compatibility.

Semantic Kernel conformance covers MCP/OpenAPI compatibility only. AICF does
not provide a native Semantic Kernel runtime.

## CLI

```bash
aicf providers list
aicf providers conformance examples --format text
aicf providers export-tools examples --provider openai --context examples/support/openai/context.support_agent.json
aicf providers export-semantic-kernel-openapi examples --context examples/support/openai/context.support_agent.json --server-url https://aicf.example.com
```

Export commands write JSON to stdout. Diagnostics are printed to stderr by
default; pass `--include-diagnostics` to include diagnostics in the JSON output.

Minimal usage is: validate manifests, pick a support or scheduling context, run
`aicf providers conformance`, then inspect any per-provider scorer diagnostics.

## Scorers

The harness checks provider-safe tool names, binding-to-capability mapping,
canonical tool-call expectations, argument validity, slice enforcement,
correlation preservation, safe error envelopes, absence of commit tools, and
absence of raw provider payload markers.

## Boundary

Host applications remain responsible for model calls, provider SDK setup,
runtime context, real authorization, approval collection, idempotency, side
effects, and audit persistence.

Live provider tests are outside this harness. Use provider-specific live test
scripts only when explicitly configured.

## Checks

```bash
npm run build
npm run test:providers:conformance
npm run check:providers:mock
```

Known limitations: Semantic Kernel is checked through MCP/OpenAPI compatibility,
not a native runtime; conformance uses canonical/mock calls, not live provider
responses; and the harness does not execute provider SDK loops.
