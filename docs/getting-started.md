# Getting Started

If you are new to AICF, start with [Start here](start-here.md). It uses the
support/refund example and includes exact commands plus expected output
excerpts.

Use this page as a short checklist when you are ready to model your own
capability.

## Checklist

1. Read the [glossary](glossary.md) so the main terms are clear.
2. Run the public support/refund walkthrough in [Start here](start-here.md).
3. Read the concrete [OpenAI walkthrough](openai-walkthrough.md), even if your
   first provider is not OpenAI. It is the baseline mental model for all
   provider adapters.
4. Pick one application behavior the model may request.
5. Write a capability manifest with strict input and output schemas.
6. Mark risk, side effects, authorization, lifecycle, and approval rules
   explicitly.
7. Add synthetic eval cases for selection, arguments, refusal, approval, and
   no-commit boundaries.
8. Run `npm run validate`.
9. Export the relevant provider tools from a routed context.
10. Keep real auth, side effects, approvals, durable storage, and audit in your
    host application.

## Useful Commands

```bash
npm run validate
npm run build
node dist/cli.js inspect examples
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

AICF validation and evals are deterministic. They do not call models, execute
side effects, or require provider credentials.
