# Adapters

AICF adapters export validated capability manifests into provider or runtime
tool descriptor shapes. They do not call models, execute handlers, persist
actions, collect approvals, or perform side effects.

Every adapter follows the same boundary:

- require a decision context with permissions and autonomy tier;
- include only capabilities whose `select` decision is `allowed`;
- exclude restricted commit, send, money-moving, permission-changing, workflow,
  and irreversible capabilities by default;
- allow restricted export only with `includeRestricted: true`, while still
  applying deterministic selection;
- bind exported names back to AICF capability IDs;
- validate parsed tool-call arguments against the original AICF input schema;
- fail closed with diagnostics when schemas or names cannot be represented
  safely.

## TypeScript APIs

OpenAI Responses:

```ts
buildOpenAIResponsesTools(registry, { context });
parseOpenAIResponsesToolCall(toolset, call);
toOpenAIResponsesToolName("support.ticket.get");
```

Anthropic Claude:

```ts
buildAnthropicClaudeTools(registry, { context });
parseAnthropicClaudeToolUse(toolset, toolUse);
toAnthropicClaudeToolName("support.ticket.get");
```

Google Gemini:

```ts
buildGeminiFunctionDeclarations(registry, { context });
parseGeminiFunctionCall(functionSet, functionCall);
toGeminiFunctionName("support.ticket.get");
```

Vercel AI SDK:

```ts
buildAiSdkTools(registry, { context });
parseAiSdkToolCall(toolset, toolCall);
toAiSdkToolName("support.ticket.get");
```

Model Context Protocol:

```ts
buildMcpToolDescriptors(registry, { context });
parseMcpToolCall(toolset, toolCall);
toMcpToolName("support.ticket.get");
```

LangChain and LangGraph:

```ts
buildLangChainToolDescriptors(registry, { context });
parseLangChainToolCall(toolset, toolCall);
toLangChainToolName("support.ticket.get");
```

Semantic Kernel:

```ts
buildSemanticKernelFunctions(registry, { context });
parseSemanticKernelFunctionCall(functionSet, functionCall);
toSemanticKernelFunctionName("support.ticket.get");
```

## CLI

All adapter commands accept a manifest path and context file:

```bash
npm run build
node dist/cli.js anthropic-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js gemini-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js ai-sdk-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js mcp-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js langchain-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js semantic-kernel-functions examples --context examples/support/openai/context.support_agent.json
```

Use `--include-restricted` only when the host has deliberately narrowed context
and still intends to run deterministic approval, idempotency, auth, and commit
checks before any side effect.

## Output Shapes

- OpenAI Responses returns `tools`.
- Anthropic Claude returns `tools`.
- Google Gemini returns `functionDeclarations`.
- Vercel AI SDK returns a keyed `tools` object.
- MCP returns `tools` descriptors.
- LangChain/LangGraph returns `tools` descriptors with metadata.
- Semantic Kernel returns `functions`.

All outputs include `bindings`, `excluded`, and `diagnostics`.

## Host Responsibilities

Adapters only produce descriptors and parse calls. Host applications remain
responsible for model requests, real authorization, facts, approvals, execution,
storage, idempotency, verification, and durable audit logs.
