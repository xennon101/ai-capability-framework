# Semantic Kernel OpenAPI Compatibility Example

This example shows the fallback Semantic Kernel path: generate OpenAPI 3.1 metadata for
a host-owned AICF executor route.

```bash
npm install ai-capability-framework
npm run build
npm run test:semantic-kernel
```

```ts
import { exportSemanticKernelOpenApiPlugin } from "ai-capability-framework/providers/semantic-kernel";
```

The generated OpenAPI document is descriptor-only. The host must implement
`POST /aicf/capabilities/{providerToolName}/execute`, resolve `runtime_context_ref`,
enforce auth and approvals, run AICF execution, and persist audit events if needed.

The OpenAPI export must not include secret auth details, tenant internals, raw provider
payloads, or commit tools.
