# Golden Tests

Golden evals capture the behavior AICF should preserve: selected capabilities,
tool call IDs, valid arguments, policy decisions, action states, and safe
output.

Run the public passing fixture:

```bash
node dist/cli.js eval examples --results examples/eval-results/public.results.passing.json
```

Expected output excerpt:

```text
Eval suite passed
```

Golden tests do not call models. Candidate results come from mocks, examples,
or optional live runs that the host explicitly enables.
