# Roadmap

AICF 1.0 focuses on making governed capability exposure understandable, portable,
testable, and release-ready.

## Current 1.0 Focus

- Public capability, entity, eval, governance, audit, security, evidence, provenance,
  replay, and provider-conformance contracts.
- No-model runtime primitives for routing, validation, read/prepare execution,
  approvals, idempotency, and audit records.
- Optional provider/runtime bridges for OpenAI, Anthropic, Gemini, Vercel AI SDK,
  LangChain/LangGraph, MCP, and Semantic Kernel-compatible hosts.
- Public docs, examples, package checks, and release readiness.

## Explicit Non-Goals

AICF is not an agent framework, model gateway, RAG framework, durable workflow engine,
production auth system, compliance product, hosted SaaS, or full content provenance
signing implementation.

## After 1.0

Future work should be driven by real adopter feedback and should preserve the same
architecture: AICF owns capability safety contracts and host applications own production
systems, credentials, side effects, and deployment.

## Capability Discovery

The optional release-candidate discovery API supports application-produced tasks,
eligible shortlists, and ordinary model tool selection. Hybrid retrieval and dedicated
selection remain explicit. No-key examples, a frozen synthetic dataset, and packed
consumer checks cover integration. The tested synthetic configuration qualifies both
lexical modes after an offline wording correction. Lexical/native is recommended; hybrid
remains experimental because incremental benefit was not qualified. See the
[qualification report](docs/evals/discovery-qualification.md). Application-specific
qualification and adoption remain separate from prerelease publication.
