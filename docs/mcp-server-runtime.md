# MCP Server Runtime

AICF MCP server runtime is an optional interoperability subpath for host applications
that want to expose routed AICF capabilities through a Model Context Protocol server.

Import it from:

```bash
npm install ai-capability-framework @modelcontextprotocol/sdk
```

```ts
import { AicfMcpServer } from "ai-capability-framework/mcp-server";
```

Descriptor-only MCP provider helpers are available separately:

```ts
import { buildMcpProviderToolDescriptors } from "ai-capability-framework/providers/mcp";
```

The package root and `ai-capability-framework/runtime` do not import the MCP SDK. The
MCP SDK is optional unless a host uses SDK registration helpers.

## Runtime Boundary

`AicfMcpServer` is an in-process server core. It does not start an HTTP, SSE, Streamable
HTTP, or stdio process by itself. Host applications own transport, authentication,
session handling, network policy, and deployment.

The server lists and executes only routed read and prepare capabilities. Commit
capabilities are not listed and are not executable through MCP tool calls. Commit
remains host-controlled through the AICF action lifecycle manager.

## Tool Listing

Minimal usage is: validate manifests, build runtime context through a trusted host
factory, route a read/prepare capability slice, instantiate `AicfMcpServer`, then bind
it to a host-owned MCP transport or SDK server.

`listTools(request)` resolves runtime context through a host-provided
`runtimeContextFactory`, builds model context through `AicfContextBuilder`, routes
capabilities through `AicfCapabilityRouter`, and returns MCP tool descriptors generated
from the validated AICF manifests through the MCP provider descriptor layer.

The context factory must validate user, tenant, account, and permission context. The MCP
client request is not a trusted identity source.

## Tool Calling

`callTool(request)` parses an MCP `tools/call`-style request, validates arguments
against the original AICF capability schema, and executes through `AicfToolExecutor`.

Tool output is a model-safe AICF runtime envelope serialized as text content. Denied,
unavailable, validation-error, and failed paths return safe MCP error results without
stack traces, raw prompts, provider payloads, or private diagnostics.

Descriptor metadata includes MCP annotations and `_meta.aicf` summaries for capability
ID, type, risk, lifecycle operation, approval requirement, security boundary, and side
effects. These are hints for MCP-compatible clients; AICF runtime validation and policy
remain authoritative.

## SDK Registration Helper

`registerAicfMcpTools()` can register the current routed tool set against a
caller-provided MCP SDK server object that exposes `registerTool()` or `tool()`. It does
not import MCP transports or create a long-running process.

```ts
await registerAicfMcpTools({
  aicfServer,
  mcpServer,
  request: { userInput: "Work on the current support ticket." }
});
```

For production MCP deployments, host applications should pin SDK versions, validate
transport auth, enforce tenant/account context on the server side, and apply the same
audit and approval controls used by other AICF runtime paths.

The public runtime support/billing example shows the executor and lifecycle objects that
an MCP host can reuse behind `AicfMcpServer.callTool()`.

## Checks

```bash
npm run build
npm run test:mcp-provider
npm run test:mcp-server
```

Known limitations: no standalone HTTP, SSE, Streamable HTTP, or stdio server; no full
MCP transport matrix; no production auth; no raw MCP payload logging; and no
model-exposed commit path.
