# 10 Trace To Golden

Fake data: sanitized replay trace at
`examples/support/replay/support.refund.approval_required.trace.json`.

Goal: replay sanitized behavior and create a review-required eval draft.

Commands:

```bash
npm run test:replay
node dist/cli.js replay run examples/support/replay/support.refund.approval_required.trace.json --mode deterministic_mock
```

Expected output:

```text
replay
passed
```

No secrets are required. No live provider calls run by default. Replay traces contain
redacted refs, hashes, summaries, and model-safe envelopes only.
