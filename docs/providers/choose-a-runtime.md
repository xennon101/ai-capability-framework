# Choose a Runtime

Start with provider-neutral AICF contracts, then pick the smallest adapter layer your
host application needs.

| Path                | Use When                                                                                | Default Test Mode                                      |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Core contracts      | You need manifests, validation, deterministic decisions, and evals without model calls. | `npm run validate`, `npm run conformance`              |
| OpenAI Responses    | You want a bounded OpenAI tool loop over routed read/prepare capabilities.              | `npm run test:openai:mock`                             |
| Anthropic Claude    | You want Claude Messages tool use over routed read/prepare capabilities.                | `npm run test:anthropic:mock`                          |
| Google Gemini       | You want GenerateContent function calling over routed read/prepare capabilities.        | `npm run test:gemini:mock`                             |
| Vercel AI SDK       | You want AI SDK tools around host-supplied `generateText` or `streamText`.              | `npm run test:ai-sdk:mock`                             |
| LangChain/LangGraph | You want LangChain tools or a host-supplied LangGraph `ToolNode`.                       | `npm run test:langchain:mock`                          |
| MCP                 | You want MCP descriptors or an AICF-backed MCP server surface.                          | `npm run test:mcp-provider`, `npm run test:mcp-server` |
| Semantic Kernel     | You want MCP guidance or OpenAPI plugin metadata for Semantic Kernel hosts.             | `npm run test:semantic-kernel`                         |

## Selection Rules

- If you are learning AICF, start with the
  [provider-neutral quickstart](../getting-started/provider-neutral-quickstart.md).
- If you already have an OpenAI app, use the
  [OpenAI quickstart](../getting-started/openai-quickstart.md).
- If you need a non-OpenAI direct runtime, use the
  [Anthropic quickstart](../getting-started/anthropic-quickstart.md) or
  [Gemini quickstart](../getting-started/gemini-quickstart.md).
- If an agent framework owns the model loop, use the AI SDK, LangChain, MCP, or Semantic
  Kernel bridge and keep AICF as the validation and lifecycle authority.

## Boundary

All runtime choices share the same safety boundary:

- provider descriptors expose routed read/prepare capabilities only;
- commit remains host-controlled through the action lifecycle;
- provider SDK validation does not replace AICF validation;
- raw provider payloads and raw prompts are not stored by default;
- live calls require explicit environment variables and host-owned credentials.
