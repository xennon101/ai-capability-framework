# Provider Conformance Example

This example shows how to verify that one routed AICF capability slice exports
consistently across supported provider and framework targets.

```bash
npm install ai-capability-framework
npm run build
npm run test:providers:conformance
node dist/cli.js providers conformance examples --format text
```

Export one provider target:

```bash
node dist/cli.js providers export-tools examples --provider anthropic --context examples/support/openai/context.support_agent.json
```

Export Semantic Kernel OpenAPI compatibility metadata:

```bash
node dist/cli.js providers export-semantic-kernel-openapi examples --context examples/support/openai/context.support_agent.json --server-url https://aicf.example.com
```

The conformance harness is descriptor/mock-only. It does not call live models,
use credentials, execute provider SDK loops, persist raw payloads, or expose
commit capabilities.
