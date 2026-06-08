# AICF Documentation

AI Capability Framework (AICF) is a provider-agnostic governed capability layer for
AI-accessible application functionality. AICF is not an agent framework.

Models propose; applications validate, authorize, execute, and audit.

## Start

1. [Installation](getting-started/installation.md)
2. [Provider-neutral quickstart](getting-started/provider-neutral-quickstart.md)
3. [Quickstart](getting-started/quickstart.md)
4. [Concepts](getting-started/concepts.md)
5. [OpenAI quickstart](getting-started/openai-quickstart.md)
6. [Anthropic quickstart](getting-started/anthropic-quickstart.md)
7. [Gemini quickstart](getting-started/gemini-quickstart.md)
8. [OpenAI walkthrough](openai-walkthrough.md)
9. [Glossary](glossary.md)

## Build The Capability Layer

- Core contracts define public manifests, schemas, validation, and deterministic
  no-execution decisions.
- Runtime, providers, governance, evals, security, observability, the control plane, and
  agent skills are optional surfaces around those contracts.

- [Capability manifests](core/capability-manifests.md)
- [Entity manifests](core/entity-manifests.md)
- [Runtime overview](runtime/runtime-overview.md)
- [Policy broker](runtime/policy-broker.md)
- [Action lifecycle](runtime/action-lifecycle.md)
- [Tool result envelope](runtime/tool-result-envelope.md)

## Connect Providers

- [Provider overview](providers.md)
- [Choose a runtime](providers/choose-a-runtime.md)
- [OpenAI](providers/openai.md)
- [Anthropic Claude](providers/anthropic.md)
- [Google Gemini](providers/gemini.md)
- [Vercel AI SDK](providers/vercel-ai-sdk.md)
- [MCP](providers/mcp.md)
- [LangChain/LangGraph](providers/langchain-langgraph.md)
- [Semantic Kernel](providers/semantic-kernel.md)
- [Provider conformance](providers/conformance.md)

## Govern, Test, And Review

- [Security overview](security/overview.md)
- [Trust, taint, redaction, and retention](security/trust-taint-redaction.md)
- [Security packs](security/security-packs.md)
- [Eval overview](evals/overview.md)
- [Golden tests](evals/golden-tests.md)
- [Replay and trace-to-golden](evals/replay-and-trace-to-golden.md)
- [Governance overview](governance/overview.md)
- [Governance gate](governance/gate.md)
- [Evidence export](evidence.md)
- [Content provenance hooks](provenance.md)

## Operate

- [Observability](observability/overview.md)
- [AWS reference adapters](aws/overview.md)
- [Control plane](control-plane/overview.md)
- [Release process](public-framework/release-process.md)
- [Final v1 certification](public-framework/v1-certification.md)
- [Final certification matrix](public-framework/final-certification-matrix.md)
- [npm release preflight](public/npm-release-preflight.md)
- [License decision](public-framework/license-decision.md)
- [Dependency license exceptions](public/license-exceptions.md)
- [Compatibility policy](public-framework/compatibility-policy.md)
- [Deprecation policy](public-framework/deprecation-policy.md)
- [Security disclosure](public-framework/security-disclosure.md)
- [API reference](api.md)
- [Public API policy](api/public-api-policy.md)
