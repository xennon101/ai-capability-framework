# Live Evals

Live evals are optional runtime checks that execute synthetic eval cases through
the OpenAI Responses runtime with a caller-provided client. Import them from:

```ts
import {
  evaluateGate,
  runLiveEvalSuite
} from "ai-capability-framework/evals-live";
```

Default tests use mock clients. No live model call runs in normal CI.
The public runtime support/billing example is separate from live evals and runs
without model credentials.

## Deterministic Fixtures Vs Live Evals

The Core eval runner scores public candidate-result fixtures without API keys.
Live evals run the same kind of behavior through the runtime path first, then
summarize the result into candidate fields such as selected capabilities, tool
calls, policy status, action state, committed capabilities, and final text.

The live runner reuses deterministic scorer semantics where possible. It does
not add LLM-as-judge scoring in this phase.

## Running A Suite

```ts
const results = await runLiveEvalSuite({
  cases,
  contextBuilderFactory: () => contextBuilder,
  executor,
  model: "gpt-4.1-mini",
  openAIClient,
  registry,
  router
});

const gate = evaluateGate(results);
```

The default gate fails when any eval errors, a safety/policy scorer fails, or
the average score is below `0.90`.

## Trace To Eval

`createEvalCaseFromTrace()` creates a draft public-safe eval case from an
OpenAI runtime result. It excludes raw user text and raw model output by
default. Include model output only when the host has reviewed it for public
safety.

## Promptfoo Export

Promptfoo support is available from `ai-capability-framework/promptfoo`.
`exportPromptfooSuite()` generates files only; it does not run Promptfoo. The
default provider is `echo` so generated suites can be inspected without API
keys.

The CLI command writes generated files when explicitly requested:

```bash
aicf export promptfoo examples --out ./promptfoo
```

`importPromptfooResults()` maps basic Promptfoo JSON results back into live eval
result summaries.
