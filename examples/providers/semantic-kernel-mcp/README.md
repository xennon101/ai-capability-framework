# Semantic Kernel MCP Compatibility Example

This example shows the recommended Semantic Kernel path: import a host-owned AICF MCP
server as a Semantic Kernel MCP plugin.

```bash
npm install ai-capability-framework @modelcontextprotocol/sdk
npm run build
npm run test:mcp-server
npm run test:semantic-kernel
```

```ts
import { AicfMcpServer } from "ai-capability-framework/mcp-server";
import { getSemanticKernelMcpIntegrationGuide } from "ai-capability-framework/providers/semantic-kernel";
```

AICF does not provide a native Semantic Kernel runtime. The host owns MCP transport,
Semantic Kernel setup, auth, tenant/account context, approvals, idempotency, audit, and
side effects. AICF remains the capability, validation, policy, lifecycle, and envelope
authority.
