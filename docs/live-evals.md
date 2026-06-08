# Live Evals

Live evals are optional runtime checks that execute synthetic eval cases through a
caller-provided provider runner. They are provider-neutral by default and keep OpenAI as
one convenience adapter. Import them from:

```ts
import {
  createOpenAILiveEvalRunner,
  evaluateGate,
  runLiveEvalSuite
} from "ai-capability-framework/evals-live";
```

Default tests use mock clients. No live model call runs in normal CI. The public runtime
support/billing example is separate from live evals and runs without model credentials.

## Deterministic Fixtures Vs Live Evals

The Core eval runner scores public candidate-result fixtures without API keys. Live
evals run the same kind of behavior through the runtime path first, then summarize the
result into candidate fields such as selected capabilities, tool calls, policy status,
action state, committed capabilities, and final text.

The live runner reuses deterministic scorer semantics where possible. It does not add
LLM-as-judge scoring in this phase.

## Running A Suite

```ts
const runner = createOpenAILiveEvalRunner({
  client: openAIClient,
  model: "gpt-4.1-mini"
});

const results = await runLiveEvalSuite({
  cases,
  contextBuilderFactory: () => contextBuilder,
  executor,
  registry,
  router,
  runner
});

const gate = evaluateGate(results);
```

The default gate fails when any eval errors, a safety/policy scorer fails, or the
average score is below `0.90`.

For source-compatible OpenAI callers, `runLiveEvalSuite({ openAIClient, model, ... })`
still works. New code should pass an explicit runner. Convenience runner factories are
available for OpenAI Responses, Anthropic Messages, Gemini GenerateContent, and Vercel
AI SDK `generateText`.

Non-OpenAI example:

```ts
import { createAnthropicLiveEvalRunner } from "ai-capability-framework/evals-live";

const runner = createAnthropicLiveEvalRunner({
  client: anthropicClient,
  model: "claude-3-5-sonnet-latest"
});
```

LangChain/LangGraph and MCP hosts can implement `AicfLiveEvalRunner` directly around
their own runtime loop. AICF does not expose commit tools to any live eval runner.

## CLI Live Evals

The CLI is for intentional live checks only:

```bash
RUN_REAL_AICF_LIVE_EVALS=1 \
OPENAI_API_KEY=... \
aicf eval-live examples --cases cases.json --provider openai --model gpt-4.1-mini
```

Supported CLI providers are `openai`, `anthropic`, and `gemini`. The AI SDK path is
available through TypeScript because host applications must supply `generateText` and a
configured model object. The CLI refuses to run live evals unless
`RUN_REAL_AICF_LIVE_EVALS=1` is set.

## Trace To Eval

`createEvalCaseFromTrace()` creates a draft public-safe eval case from an OpenAI runtime
result. It excludes raw user text and raw model output by default. Include model output
only when the host has reviewed it for public safety.

## Promptfoo Export

Promptfoo support is available from `ai-capability-framework/promptfoo`.
`exportPromptfooSuite()` generates files only; it does not run Promptfoo. The default
provider is `echo` so generated suites can be inspected without API keys.

The CLI command writes generated files when explicitly requested:

```bash
aicf export promptfoo examples --out ./promptfoo
```

`importPromptfooResults()` maps basic Promptfoo JSON results back into live eval result
summaries.

Capability-aware security packs have a focused Promptfoo export under
`ai-capability-framework/security-packs`. That export generates red-team config
templates with `echo` as the default provider and placeholders for host runtime targets.
AICF does not run Promptfoo or call providers when exporting those files.

## EvalOps Exports

`ai-capability-framework/evalops` provides dependency-free JSON exporters and importers
for Braintrust-style and OpenAI-eval-style datasets/results. These helpers transform
public-safe eval cases and summarized results only. They do not upload data, call
external services, or require provider SDKs.
