# F0 Baseline Gaps

This note records the F0 baseline reconciliation result for the public
repository. It is intentionally limited to public implementation facts.

## Findings

- Core repairs are present: schemas, manifest loading, registry construction,
  capability decisions, adapter exports, tool-result envelopes, and eval scoring
  are covered by deterministic tests.
- Runtime APIs are present under the runtime subpath and provide context,
  routing, policy, handler execution, action lifecycle, in-memory stores, audit,
  redaction, and envelope helpers.
- Provider APIs are present under optional subpaths for OpenAI, Anthropic,
  Gemini, AI SDK, LangChain, MCP, Semantic Kernel, AWS, observability, live eval,
  Promptfoo, Langfuse, and MCP server integrations.
- Release hygiene exists through package contents checks, public artifact
  checks, workspace hygiene checks, source archive checks, and clean install
  smoke tests.
- The explicit `npm run typecheck` command has been added for F0 command
  compatibility.
- The current public architecture is documented in
  `docs/architecture/current-state.md`.

## Result

No unresolved F0 baseline gaps remain. Later phases can use this baseline as the
starting point, while still adding their own focused contracts, tests, and
documentation.
