# OpenAI Responses Adapter

The OpenAI Responses adapter exports AICF capabilities as no-model-call function
tool definitions. It converts validated manifests into tool definitions and maps
model tool calls back to capability IDs and validated arguments.

The adapter does not call OpenAI, execute handlers, persist action state, verify
real authorization, collect approvals, commit side effects, or write audit logs.
Host applications own those runtime responsibilities.

For the optional live Responses tool loop, see
[OpenAI Responses runtime](openai-runtime.md). The adapter on this page exports
descriptor JSON only.

## Tool Export

Use `buildOpenAIResponsesTools(registry, options)` with a validated registry and
a request context:

```ts
const toolset = buildOpenAIResponsesTools(registry, {
  context: {
    autonomyTier: "A2",
    permissions: ["ticket.read", "refund.case.create"]
  }
});
```

The result contains:

- `tools`: OpenAI Responses function tools.
- `bindings`: tool-name to capability-ID mappings.
- `excluded`: capabilities not exported and the reason.
- `diagnostics`: export warnings or fatal name-collision errors.

By default the adapter exports only capabilities whose `select` decision is
allowed. For export, the context autonomy tier is treated as the toolset ceiling
and capped at each capability's own autonomy tier before the select decision is
evaluated. This lets an `A2` toolset include an `A1` read capability while still
preserving capability-level autonomy limits.

The adapter also excludes restricted side-effect capabilities, including commit,
send, irreversible, money-moving, permission-changing, and workflow-triggering
capabilities. Use `includeRestricted: true` only when the host application has
already narrowed context and is deliberately constructing a restricted toolset.

## OpenAI Shape

Exported tools use the Responses function tool shape:

```json
{
  "type": "function",
  "name": "aicf_support_ticket_get",
  "description": "Use this capability...",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "strict": true
}
```

Tool names use `aicf_` plus a sanitized capability ID. Long names are capped at
64 characters with a deterministic hash suffix. Tool descriptions include the
manifest model description, capability type, risk tier, autonomy tier, lifecycle
flags, and use guidance.

The adapter normalizes input schemas for OpenAI strict mode by making object
properties required, representing optional fields as nullable where possible,
and setting `additionalProperties: false`. Schemas that cannot be represented
safely are excluded with diagnostics.

## Tool Call Parsing

Use `parseOpenAIResponsesToolCall(toolset, call)` after a model returns a
Responses `function_call` item. The parser:

- resolves the OpenAI tool name to an AICF capability ID;
- parses the JSON argument string;
- validates arguments against the capability input schema;
- returns structured diagnostics for unknown tools, invalid JSON, and schema
  failures.

The parser does not execute the capability. The host application should run a
fresh deterministic decision before prepare or commit execution.

## CLI

Build the CLI, then export tools from the public examples:

```bash
npm run build
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
```

The command prints JSON containing `tools`, `bindings`, `excluded`, and
`diagnostics`. It exits nonzero for invalid manifests, missing or invalid
context JSON, tool-name collisions, or when no tools are exportable.

## Reference Basis

OpenAI Responses accepts function tools in the request `tools` array. Function
tools use JSON Schema parameters, and strict schema adherence is recommended for
reliable function calling.
