# Getting Started

If you are new to AICF, start with [Start here](start-here.md). It uses the
support/refund example and includes exact commands plus expected output excerpts.

Use this page as a short checklist when you are ready to model your own capability.

## Checklist

1. Read the [glossary](glossary.md) so the main terms are clear.
2. Run the no-key
   [provider-neutral quickstart](getting-started/provider-neutral-quickstart.md).
3. Run the public support/refund walkthrough in [Start here](start-here.md).
4. Choose a provider/runtime path with
   [Choose a Runtime](providers/choose-a-runtime.md).
5. Use the provider quickstart that matches your host app:
   [OpenAI](getting-started/openai-quickstart.md),
   [Anthropic](getting-started/anthropic-quickstart.md), or
   [Gemini](getting-started/gemini-quickstart.md).
6. Pick one application behavior the model may request.
7. Write a capability manifest with strict input and output schemas.
8. Mark risk, side effects, authorization, lifecycle, and approval rules explicitly.
9. Add synthetic eval cases for selection, arguments, refusal, approval, and no-commit
   boundaries.
10. Run `npm run validate`.
11. Export the relevant provider tools from a routed context.
12. Keep real auth, side effects, approvals, durable storage, and audit in your host
    application.

## Useful Commands

```bash
npm run validate
npm run build
node dist/cli.js inspect examples
node dist/cli.js decide examples --request examples/support/decisions/support.ticket.get.select.json
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

AICF validation and evals are deterministic. They do not call models, execute side
effects, or require provider credentials.
