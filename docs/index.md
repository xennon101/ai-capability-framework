# AICF Documentation

AI Capability Framework is a governed capability layer for AI-accessible
application functionality. AICF is not an agent framework.

Models propose; applications validate, authorize, execute, and audit.

## Start

1. [Installation](getting-started/installation.md)
2. [Quickstart](getting-started/quickstart.md)
3. [Concepts](getting-started/concepts.md)
4. [OpenAI walkthrough](openai-walkthrough.md)
5. [Glossary](glossary.md)

## Build The Capability Layer

- [Capability manifests](core/capability-manifests.md)
- [Entity manifests](core/entity-manifests.md)
- [Runtime overview](runtime/runtime-overview.md)
- [Policy broker](runtime/policy-broker.md)
- [Action lifecycle](runtime/action-lifecycle.md)
- [Tool result envelope](runtime/tool-result-envelope.md)

## Connect Providers

- [Provider overview](providers.md)
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
- [Compatibility policy](public-framework/compatibility-policy.md)
- [Deprecation policy](public-framework/deprecation-policy.md)
- [Security disclosure](public-framework/security-disclosure.md)
- [API reference](api.md)
