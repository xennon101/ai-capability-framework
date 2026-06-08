# LangGraph ToolNode Provider Example

This example shows the public-safe shape for wrapping AICF-backed LangChain tools in a
host-supplied LangGraph `ToolNode`.

```bash
npm install ai-capability-framework @langchain/core langchain zod
npm run build
npm run test:langchain:mock
```

```ts
import { buildLangGraphToolNode } from "ai-capability-framework/providers/langchain";
```

AICF does not import LangGraph by default. The host passes a compatible `ToolNode`
constructor, and AICF supplies routed read/prepare tools that enforce AICF validation,
policy, lifecycle, and envelope boundaries.

Commit tools are not generated for LangGraph agent loops. Host applications own approval
collection and lifecycle commit after a stored prepared action.
