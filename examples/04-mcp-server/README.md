# 04 MCP Server

Fake data: synthetic support manifests and mock runtime handlers.

Goal: understand how AICF can expose routed read/prepare capabilities as MCP
tools while keeping commit unavailable to model clients.

Commands:

```bash
npm run test:mcp-server
npm run test:mcp-provider
```

Expected output:

```text
Test Files
passed
```

No secrets are required. No live provider calls run by default. R6 does not add
a standalone HTTP or stdio server; hosts wire `AicfMcpServer` to their own MCP
transport.
