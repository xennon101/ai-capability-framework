# Quickstart

The fastest path is the public support/refund walkthrough:

```bash
npm install
npm run build
npm run validate
node dist/cli.js inspect examples
node dist/cli.js openai-tools examples --context examples/support/openai/context.support_agent.json
node examples/runtime-support-billing/run-mock.mjs
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

Expected output excerpts:

```text
Validated 16 manifest(s) and 18 fixture(s).
Manifests: 16 (6 capabilities, 4 entities, 6 evals)
approval_required
Eval suite passed
```

What this proves:

- manifests and fixtures validate;
- read/prepare tools can be exported without exposing commit tools;
- the runtime can read, prepare, require approval, and commit through host lifecycle
  APIs;
- evals prove expected behavior without calling a model.

Full command explanations are in [Start here](../start-here.md).
