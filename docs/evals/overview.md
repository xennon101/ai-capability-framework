# Eval Overview

AICF evals are deterministic fixtures. They prove capability selection, expected tool
calls, policy outcomes, approval behavior, and no-commit boundaries without calling a
model.

Read:

- [Eval runner](../eval-runner.md)
- [Eval manifests](../evals.md)
- [Golden tests](golden-tests.md)
- [Replay and trace-to-golden](replay-and-trace-to-golden.md)
- [Live evals](../live-evals.md)
- [EvalOps export interfaces](../evalops.md)

## Discovery and selection evaluation

Use [discovery evaluation](../discovery.md#offline-evaluation-and-quality) for frozen
synthetic cases, compatible and forbidden ID sets, separate retrieval/selection metrics,
and explicit accounting completeness. No-key CI validates contracts; model quality
requires a separately configured evaluation. The
[discovery live campaign](discovery-live.md) provides bounded, resumable evaluation with
caller-supplied clients; its default command remains provider-free.
