# Roadmap

AICF 1.0 focuses on making governed capability exposure understandable,
portable, testable, and release-ready.

## Current 1.0 Focus

- Public capability, entity, eval, governance, audit, security, evidence,
  provenance, replay, and provider-conformance contracts.
- No-model runtime primitives for routing, validation, read/prepare execution,
  approvals, idempotency, and audit records.
- Optional provider/runtime bridges for OpenAI, Anthropic, Gemini, Vercel AI
  SDK, LangChain/LangGraph, MCP, and Semantic Kernel-compatible hosts.
- Public docs, examples, package checks, and release readiness.

## Explicit Non-Goals

AICF is not an agent framework, model gateway, RAG framework, durable workflow
engine, production auth system, compliance product, hosted SaaS, or full content
provenance signing implementation.

## After 1.0

Future work should be driven by real adopter feedback and should preserve the
same architecture: AICF owns capability safety contracts and host applications
own production systems, credentials, side effects, and deployment.
