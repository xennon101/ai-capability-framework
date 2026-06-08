# Changelog

All notable public changes to AI Capability Framework are documented here.

## Unreleased

- Prepared the `1.0.0-rc.4` release candidate and made `@aicf/agent-skills` a
  first-class same-version npm artifact in certification, CI, release dry-run, and
  trusted-publishing workflows.
- Added the final v1.0 certification gate with `check:public`, `check:certification`,
  public certification docs, workflow hardening, and release-readiness assertions for
  v1.0-ready release notes.
- Added public repository release-readiness hardening with CI, docs, security, and
  release dry-run workflows plus lint, conformance, governance-gate, package, source
  archive, and secret-scan checks.
- Added a first-time developer onboarding pass with a simplified README, start-here
  guide, OpenAI walkthrough, glossary, and clearer eval/runtime navigation.
- Added the `ai-capability-framework/runtime` subpath for deterministic runtime context,
  redaction, capability routing, policy brokering, handler registry, no-model
  read/prepare execution, host-controlled action lifecycle, in-memory reference stores,
  audit events, and runtime result envelopes.
- Added the optional `ai-capability-framework/openai` subpath for a bounded
  non-streaming OpenAI Responses loop with caller-provided clients, routed read/prepare
  tools, R2 executor integration, and model-safe tool envelopes.
- Added optional observability, Langfuse, live eval, Promptfoo export, and EvalOps
  subpaths with metadata-only tracing defaults, tracer adapters, dependency-free
  Braintrust/OpenAI eval export helpers, and mock-driven tests.
- Added the optional `ai-capability-framework/aws` subpath for DynamoDB runtime stores,
  canonical audit ledger stores, controls, control-plane state, budget usage, Step
  Functions approval handoff, EventBridge/CloudWatch publishing, KMS redaction refs, and
  fake AWS test clients.
- Added the optional `ai-capability-framework/mcp-server` subpath and OpenAI Agents SDK
  bridge for executor-backed read/prepare interoperability.
- Added a public runtime support/billing mock example plus action lifecycle, policy
  broker, and release-hardening docs and scripts.
- Added the `ai-capability-framework/providers` shared foundation for provider-neutral
  tool naming, schema normalization, call parsing, safe result formatting, optional
  dependency loading, and executor-backed read/prepare calls.
- Added the optional `ai-capability-framework/providers/anthropic` subpath for a bounded
  Claude Messages tool-use loop with caller-provided clients and AICF-backed
  read/prepare execution.
- Added the optional `ai-capability-framework/providers/gemini` subpath for a bounded
  Gemini GenerateContent function-calling loop with caller-provided clients and
  AICF-backed read/prepare execution.
- Added the optional `ai-capability-framework/providers/ai-sdk` subpath for a Vercel AI
  SDK tool bridge and host-supplied `generateText`/`streamText` wrappers with
  AICF-backed read/prepare execution.
- Added the optional `ai-capability-framework/providers/langchain` subpath for LangChain
  tools and a host-supplied LangGraph `ToolNode` bridge with AICF-backed read/prepare
  execution.
- Added the optional `ai-capability-framework/providers/mcp` subpath for hardened MCP
  descriptors, annotations, security summaries, and tool-call parsing from routed AICF
  capability slices.
- Added the optional `ai-capability-framework/providers/conformance` subpath and
  `aicf providers` CLI group for descriptor-only cross-provider conformance checks.
- Added the canonical `ai-capability-framework/conformance` subpath, `aicf conformance`
  CLI group, conformance schemas, richer F7 reports, and provider target matrix output
  while preserving provider conformance aliases.
- Added grouped public provider examples, provider release scripts, and provider
  package-readiness assertions for multi-vendor release review.
- Added the optional `ai-capability-framework/providers/semantic-kernel` subpath for MCP
  guidance plus OpenAPI/plugin metadata exports for Semantic Kernel-compatible hosts.
- Added the `ai-capability-framework/governance` subpath and `aicf governance` CLI group
  for lifecycle transition checks, risk compilation, compatibility diffs, and registry
  impact analysis.
- Added the governance gate APIs and `aicf gate` CLI command for CI-friendly validation,
  risk, lifecycle, compatibility, impact, eval coverage, security-pack coverage,
  configured provider conformance, and public artifact hygiene checks.
- Added the optional `ai-capability-framework/control-plane` subpath and a
  credential-free local reference app for reviewing capabilities, governance status,
  eval/security/conformance coverage, redacted ledgers, approvals, controls, replay
  metadata, and evidence exports.
- Added the optional `ai-capability-framework/audit` subpath with schema-valid policy
  decision, action, approval, and idempotency ledger records plus in-memory reference
  stores and runtime ledger hooks.
- Added the optional `ai-capability-framework/security` subpath for trust segments,
  taint/provenance metadata, provider/trace redaction, and retention policy evaluation.
- Added the optional `ai-capability-framework/memory` subpath for governed host-owned
  memory and preference summaries, use-case/scope exposure checks, and conversion to
  security/runtime context.
- Added the optional `ai-capability-framework/evidence` subpath and
  `aicf evidence export` CLI for public-safe JSON/Markdown evidence packs with required
  disclaimers and explicit coverage gaps.
- Added the optional `ai-capability-framework/provenance` subpath for public-safe
  generated-content provenance metadata, strict schemas, adapter hooks, docs, and a
  synthetic refs-and-hashes support fixture.
- Added public documentation and developer-experience hardening with root
  governance/conduct/roadmap docs, grouped docs navigation, numbered examples, TypeDoc
  tooling, docs checks, and package-readiness assertions.
- Added the optional `ai-capability-framework/controls` subpath for runtime kill
  switches, circuit breaker evaluation, per-run budgets, local control CLI commands,
  controls schemas, docs, and runtime/provider enforcement hooks.
- Added the optional `ai-capability-framework/replay` subpath for sanitized runtime
  replay, policy/router/tool-validation simulation, trace-to-golden eval drafting,
  replay schemas, CLI commands, and a public-safe support replay fixture.
- Added the optional `ai-capability-framework/security-packs` subpath with built-in
  capability-aware security test packs, coverage reporting, public-safe generated
  security cases, Promptfoo red-team config export, schemas, CLI commands, and docs.
- Kept provider/model calls, production storage, and model-exposed commit out of the
  Core/runtime boundary except for the optional OpenAI subpath.

## 1.0.0-rc.1 - 2026-06-03

1.0 spec-complete release candidate.

- Promoted public manifests and eval result fixtures to `schema_version: "1.0"`.
- Made the spec normative and explicit about the no-execution boundary.
- Added migration, host responsibility, and interoperability guidance.
- Added a second synthetic domain and conformance fixtures for external review.
- Added no-model-call adapters for Anthropic Claude, Google Gemini, Vercel AI SDK, Model
  Context Protocol, LangChain/LangGraph, and Semantic Kernel.
- Enabled public npm release-candidate publishing while keeping the no-execution
  framework boundary.

## 0.1.0 - 2026-06-03

Initial public v0.1 release candidate.

- Added JSON Schema contracts for capability, entity, eval case, and eval result
  manifests.
- Added synthetic support examples for read, prepare-only write, commit, policy,
  approval, refusal, and eval boundaries.
- Added a TypeScript core library and `aicf` CLI for loading, validating, inspecting,
  deciding, OpenAI tool export, and deterministic eval scoring.
- Added deterministic policy and lifecycle decision APIs without executing capabilities
  or performing side effects.
- Added a no-model-call OpenAI Responses adapter for exporting function tool definitions
  and parsing tool calls.
- Added an API-key-free eval runner for scoring candidate result fixtures.
- Added release-readiness package checks, public API docs, CI validation, and public
  repository boundary guidance.

This release was GitHub-release-ready only and was not published to npm.
