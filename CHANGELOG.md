# Changelog

All notable public changes to AI Capability Framework are documented here.

## Unreleased

- Added the `ai-capability-framework/runtime` subpath for deterministic runtime
  context, redaction, capability routing, policy brokering, handler registry,
  no-model read/prepare execution, host-controlled action lifecycle, in-memory
  reference stores, audit events, and runtime result envelopes.
- Added the optional `ai-capability-framework/openai` subpath for a bounded
  non-streaming OpenAI Responses loop with caller-provided clients, routed
  read/prepare tools, R2 executor integration, and model-safe tool envelopes.
- Added optional observability, Langfuse, live eval, and Promptfoo export
  subpaths with metadata-only tracing defaults and mock-driven tests.
- Added the optional `ai-capability-framework/aws` subpath for DynamoDB runtime
  stores, Step Functions approval handoff, EventBridge publishing, and fake AWS
  test clients.
- Added the optional `ai-capability-framework/mcp-server` subpath and OpenAI
  Agents SDK bridge for executor-backed read/prepare interoperability.
- Added a public runtime support/billing mock example plus action lifecycle,
  policy broker, and release-hardening docs and scripts.
- Added the `ai-capability-framework/providers` shared foundation for
  provider-neutral tool naming, schema normalization, call parsing, safe result
  formatting, optional dependency loading, and executor-backed read/prepare
  calls.
- Added the optional `ai-capability-framework/providers/anthropic` subpath for a
  bounded Claude Messages tool-use loop with caller-provided clients and
  AICF-backed read/prepare execution.
- Added the optional `ai-capability-framework/providers/gemini` subpath for a
  bounded Gemini GenerateContent function-calling loop with caller-provided
  clients and AICF-backed read/prepare execution.
- Added the optional `ai-capability-framework/providers/ai-sdk` subpath for a
  Vercel AI SDK tool bridge and host-supplied `generateText`/`streamText`
  wrappers with AICF-backed read/prepare execution.
- Added the optional `ai-capability-framework/providers/langchain` subpath for
  LangChain tools and a host-supplied LangGraph `ToolNode` bridge with
  AICF-backed read/prepare execution.
- Added the optional `ai-capability-framework/providers/mcp` subpath for
  hardened MCP descriptors, annotations, security summaries, and tool-call
  parsing from routed AICF capability slices.
- Added the optional `ai-capability-framework/providers/conformance` subpath and
  `aicf providers` CLI group for descriptor-only cross-provider conformance
  checks.
- Added grouped public provider examples, provider release scripts, and
  provider package-readiness assertions for multi-vendor release review.
- Added the optional `ai-capability-framework/providers/semantic-kernel`
  subpath for MCP guidance plus OpenAPI/plugin metadata exports for
  Semantic Kernel-compatible hosts.
- Kept provider/model calls, production storage, and model-exposed commit out of
  the Core/runtime boundary except for the optional OpenAI subpath.

## 1.0.0-rc.1 - 2026-06-03

1.0 spec-complete release candidate.

- Promoted public manifests and eval result fixtures to
  `schema_version: "1.0"`.
- Made the spec normative and explicit about the no-execution boundary.
- Added migration, host responsibility, and interoperability guidance.
- Added a second synthetic domain and conformance fixtures for external review.
- Added no-model-call adapters for Anthropic Claude, Google Gemini, Vercel AI
  SDK, Model Context Protocol, LangChain/LangGraph, and Semantic Kernel.
- Enabled public npm release-candidate publishing while keeping the no-execution
  framework boundary.

## 0.1.0 - 2026-06-03

Initial public v0.1 release candidate.

- Added JSON Schema contracts for capability, entity, eval case, and eval result
  manifests.
- Added synthetic support examples for read, prepare-only write, commit, policy,
  approval, refusal, and eval boundaries.
- Added a TypeScript core library and `aicf` CLI for loading, validating,
  inspecting, deciding, OpenAI tool export, and deterministic eval scoring.
- Added deterministic policy and lifecycle decision APIs without executing
  capabilities or performing side effects.
- Added a no-model-call OpenAI Responses adapter for exporting function tool
  definitions and parsing tool calls.
- Added an API-key-free eval runner for scoring candidate result fixtures.
- Added release-readiness package checks, public API docs, CI validation, and
  public repository boundary guidance.

This release was GitHub-release-ready only and was not published to npm.
