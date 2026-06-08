# Current Architecture State

This document records the public baseline used for the F0 reconciliation gate.
It describes the current repository shape before later governance-completion
work begins.

## Core Package Boundary

The package root is the provider-neutral Core API. It loads and validates public
manifests, builds registries, selects capability slices, exports descriptor-only
adapter tools, parses provider tool calls back to AICF capability IDs, scores
deterministic eval fixtures, and formats model-safe tool results.

The package root must not call model providers, execute host side effects,
persist approvals, or require optional provider SDKs. Host applications remain
responsible for authentication, authorization, provider clients, durable
storage, approval UI, audit retention, and final side-effect execution.

## Runtime And Provider Subpaths

The runtime subpath provides deterministic host-controlled runtime utilities:
context building, policy brokering, capability routing, redaction, handler
registration, read/prepare execution, action lifecycle stores, audit events, and
runtime envelopes. It does not call model providers or expose commit execution
to model-facing tools.

The provider-specific APIs live behind optional subpaths. OpenAI, Anthropic,
Gemini, AI SDK, LangChain, MCP, Semantic Kernel, AWS, observability, live eval,
Promptfoo, Langfuse, and MCP server integrations are imported only by their
dedicated subpaths. Optional SDKs are peer dependencies and are loaded only when
a host uses the relevant integration.

## Validation And Release Gates

The repository baseline includes schema validation, generated type freshness,
TypeScript build/typechecking, deterministic tests, manifest validation, package
contents checks, public hygiene checks, workspace hygiene checks, and clean
consumer install smoke tests.

The public hygiene checks keep private drafts, raw prompts, traces, provider
payloads, generated local artifacts, credentials, archives, and local-only
material out of tracked and package-published paths.

## Public Examples

Public examples are synthetic. They demonstrate support and scheduling
capability manifests, eval fixtures, decision fixtures, provider exports, and a
mock runtime flow without using real tenants, customers, credentials, provider
payloads, raw prompts, or production endpoints.
