# Semantic Kernel OpenAPI Example

This example describes the fallback Semantic Kernel path for hosts that import OpenAPI
plugins.

The grouped provider example is available at
`examples/providers/semantic-kernel-openapi/`.

Use:

```ts
import { exportSemanticKernelOpenApiPlugin } from "ai-capability-framework/providers/semantic-kernel";

const exported = exportSemanticKernelOpenApiPlugin({
  registry,
  serverUrl: "https://aicf.example.com",
  slice
});
```

The generated OpenAPI 3.1 document describes a host-owned route:

```text
POST /aicf/capabilities/{providerToolName}/execute
```

The route must resolve `runtime_context_ref` to trusted host context, validate the
requested capability through AICF, execute only read/prepare operations, return
model-safe envelopes, and keep commit behind host-controlled approval and idempotency
checks.

This example is documentation-only. It does not start an HTTP server, call models,
execute handlers, persist data, or include real identifiers.
