# Replay And Trace-To-Golden

Replay turns a sanitized runtime trace into something you can compare later.
Trace-to-golden turns that same trace into a draft eval case.

Both features are API-key-free by default. They do not call models, import provider
SDKs, execute handlers, store raw prompts, or keep raw provider payloads.

## What Goes In A Replay Trace

A replay trace is a public-safe summary, not a raw trace. It can include:

- selected capability IDs;
- capability versions;
- redacted context and decision context;
- canonical tool calls and model-safe tool results;
- policy decision records;
- action and approval states;
- a redacted final response summary;
- hashes and redaction summaries.

Do not put raw prompts, raw provider payloads, raw tool outputs, secrets, customer
records, tenant IDs, account IDs, or stack traces in replay fixtures.

The public example is:

```text
examples/support/replay/support.refund.approval_required.trace.json
```

## Replay Modes

`deterministic_mock` compares the recorded trace summary without provider calls.

```bash
node dist/cli.js replay run examples/support/replay/support.refund.approval_required.trace.json --mode deterministic_mock
```

`policy_only` reruns AICF policy decisions against the current manifests and redacted
decision context.

```bash
node dist/cli.js replay run examples/support/replay/support.refund.approval_required.trace.json --mode policy_only --manifest-root examples
```

`router_only` reruns deterministic capability selection and checks whether the selected
capability slice changed.

`tool_validation_only` validates recorded tool-call arguments against the current
capability input schemas.

`provider_live` is guarded. It refuses by default unless the host explicitly enables
live replay and provides its own runner/client.

## Create A Draft Eval

Generate a public-safe eval draft from the replay fixture:

```bash
node dist/cli.js evals create-from-trace examples/support/replay/support.refund.approval_required.trace.json --suite support-refunds --out tmp/support.refund.from_trace.yaml
```

The generated eval uses redacted user text by default and marks itself as
review-required in `extensions.aicf_replay`. Review the draft before moving it under
`examples/**/evals/`.

## What The Draft Proves

The generated eval can assert:

- the expected read/prepare capability selection;
- expected tool arguments as JSON subsets;
- policy decision status such as `approval_required`;
- action state such as `approval_required`;
- no unapproved commit;
- forbidden commit tool calls;
- response text must not expose private diagnostics, raw prompts, provider payloads,
  tokens, or secrets.

## TypeScript API

```ts
import {
  createGoldenFromTrace,
  runReplay,
  validateReplayTrace
} from "ai-capability-framework/replay";
```

Host applications own production trace collection, storage, retention, review workflow,
and any live-provider replay runner. AICF only provides public-safe contracts and
deterministic comparison helpers.
