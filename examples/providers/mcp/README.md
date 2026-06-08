# MCP Provider Example

This example shows the public-safe shape for exposing routed AICF capabilities through
Model Context Protocol descriptors and server calls.

```bash
npm install ai-capability-framework @modelcontextprotocol/sdk
npm run build
npm run test:mcp-provider
npm run test:mcp-server
```

```ts
import { buildMcpProviderToolDescriptors } from "ai-capability-framework/providers/mcp";
import { AicfMcpServer } from "ai-capability-framework/mcp-server";
```

The descriptor subpath creates MCP tool metadata from a routed slice. The server subpath
executes only read and prepare calls through `AicfToolExecutor`. MCP client identity is
never trusted; the host `runtimeContextFactory` must resolve authenticated user, tenant,
account, and permission context.

Do not add standalone transport servers, raw MCP payload fixtures, or commit tools to
public examples.
