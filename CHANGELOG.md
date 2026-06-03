# Changelog

All notable public changes to AI Capability Framework are documented here.

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
