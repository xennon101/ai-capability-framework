# Semantic Kernel Compatibility

AICF supports Semantic Kernel through compatibility exports, not through a
native Semantic Kernel runtime package.

The recommended path is MCP: expose a routed AICF capability slice through
`ai-capability-framework/mcp-server`, then import that MCP server as a Semantic
Kernel plugin when the host runtime supports MCP plugins.

The fallback path is OpenAPI: generate an OpenAPI 3.1 descriptor for a
host-owned HTTP executor route, then import that descriptor as a Semantic Kernel
OpenAPI plugin.

## Import

Install AICF in hosts that generate Semantic Kernel compatibility metadata. No
Semantic Kernel npm dependency is required by AICF.

```bash
npm install ai-capability-framework
```

```ts
import {
  exportSemanticKernelOpenApiPlugin,
  exportSemanticKernelPluginMetadata,
  getSemanticKernelMcpIntegrationGuide
} from "ai-capability-framework/providers/semantic-kernel";
```

This subpath has no Semantic Kernel dependency and performs no model calls,
handler execution, storage, approval runtime, or side effects.

Minimal usage is either: expose a routed AICF MCP server and import it as a
Semantic Kernel MCP plugin, or generate OpenAPI metadata for a host-owned
executor route and import that descriptor as an OpenAPI plugin.

## MCP Path

Use `AicfMcpServer` to list and call routed read/prepare capabilities through
the AICF runtime. Semantic Kernel imports the host MCP server; AICF remains the
policy, validation, lifecycle, approval, idempotency, and envelope authority.

Do not expose commit capabilities through MCP. Commit remains host-controlled
through `AicfActionLifecycleManager` after a stored prepared action, approval,
and idempotency check.

## OpenAPI Export

`exportSemanticKernelOpenApiPlugin()` returns a descriptor-only OpenAPI 3.1
document. It creates one operation per exported read/prepare capability:

```text
POST /aicf/capabilities/{providerToolName}/execute
```

Each request body contains:

- `args`: the capability input object;
- `runtime_context_ref`: an opaque host reference used to resolve authenticated
  runtime context server-side.

The generated document intentionally does not expose auth, permission, tenant,
account, approval, idempotency, or audit internals. The host executor route must
resolve those values and enforce them before invoking AICF runtime objects.

## Plugin Metadata

`exportSemanticKernelPluginMetadata()` returns a small metadata object with the
plugin name, function summaries, MCP recommendation, OpenAPI import hints, and
warnings for automatic invocation.

## Boundary

- AICF does not import `semantic-kernel` or an unofficial TypeScript Semantic
  Kernel runtime.
- AICF does not start an HTTP server for the generated OpenAPI descriptor.
- AICF does not call models or provider SDKs in this subpath.
- AICF does not expose commit capabilities to Semantic Kernel.
- Host applications own auth, account and tenant authority, approvals,
  idempotency, side effects, and audit persistence.
- Treat approval-required envelopes as pauses, not completed actions.

Known limitations: no native Semantic Kernel runtime, no hosted HTTP executor,
no model calls, no production auth, no approval UI, and no model-exposed commit
path.

## Checks

```bash
npm run build
npm run test:semantic-kernel
```
