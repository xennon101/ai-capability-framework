# Public API Policy

AICF treats published package exports as public contracts. The root package is the
stable Core and descriptor API. Runtime, provider, governance, security, storage,
control-plane, eval, and CLI utilities live behind explicit subpaths so applications can
import only the surface they use.

## Root API Policy

The root import is reserved for stable Core and descriptor APIs. It should stay small
enough that applications can import it without pulling optional runtime, provider,
cloud, tracing, or CLI implementation dependencies.

## Import Policy

- Use `ai-capability-framework` for Core contracts, manifest loading, validation,
  deterministic decisions, eval helpers, descriptor adapters, and model-safe tool
  results.
- Use subpaths for optional runtime or integration surfaces, such as
  `ai-capability-framework/runtime`, `ai-capability-framework/openai`, and
  `ai-capability-framework/providers/anthropic`.
- Use `ai-capability-framework/cli` only for programmatic CLI tests or tooling. The
  `runCli` helper is intentionally not exported from the root package.
- The `aicf` binary remains the supported command-line entrypoint for normal CLI use.
- Optional provider, AWS, OpenTelemetry, Langfuse, MCP, LangChain, AI SDK, and Agents
  SDK packages must not be required by the root import.

## Export Classifications

| Surface                                                                                                                                                                                                                                                     | Classification                      | Notes                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-capability-framework`                                                                                                                                                                                                                                   | stable public                       | Core manifests, loading, validation, deterministic decisions, eval helpers, descriptor-only adapters, registry helpers, and model-safe tool-result helpers. |
| `ai-capability-framework/runtime`                                                                                                                                                                                                                           | release-candidate public            | No-model runtime context, routing, policy, handler registry, executor, lifecycle, stores, audit events, and envelopes.                                      |
| `ai-capability-framework/openai`                                                                                                                                                                                                                            | adapter public                      | Optional OpenAI Responses runtime and OpenAI Agents SDK bridge.                                                                                             |
| `ai-capability-framework/providers`                                                                                                                                                                                                                         | adapter public                      | Shared provider foundation for names, schemas, calls, results, optional dependencies, and provider execution helpers.                                       |
| `ai-capability-framework/providers/*`                                                                                                                                                                                                                       | adapter public                      | Provider-specific or framework-bridge adapter surfaces for Anthropic, Gemini, AI SDK, LangChain, MCP, Semantic Kernel, and conformance helpers.             |
| `ai-capability-framework/mcp-server`                                                                                                                                                                                                                        | adapter public                      | Optional MCP server runtime surface backed by AICF routing and execution.                                                                                   |
| `ai-capability-framework/aws`                                                                                                                                                                                                                               | adapter public                      | Optional AWS reference adapters. AWS SDK imports stay isolated to this subpath.                                                                             |
| `ai-capability-framework/observability`, `ai-capability-framework/langfuse`                                                                                                                                                                                 | release-candidate public            | Optional metadata/redacted-content tracing and Langfuse adapters.                                                                                           |
| `ai-capability-framework/evals-live`, `ai-capability-framework/evalops`, `ai-capability-framework/promptfoo`                                                                                                                                                | release-candidate public            | Optional eval and EvalOps export/import helpers. Live paths are opt-in.                                                                                     |
| `ai-capability-framework/governance`, `ai-capability-framework/controls`, `ai-capability-framework/conformance`                                                                                                                                             | release-candidate public            | Governance, runtime controls, and deterministic conformance gates.                                                                                          |
| `ai-capability-framework/audit`, `ai-capability-framework/security`, `ai-capability-framework/security-packs`, `ai-capability-framework/replay`, `ai-capability-framework/evidence`, `ai-capability-framework/memory`, `ai-capability-framework/provenance` | release-candidate public            | Public-safe evidence, security, replay, memory, and provenance utility contracts.                                                                           |
| `ai-capability-framework/control-plane`                                                                                                                                                                                                                     | release-candidate public            | Framework-neutral request router and reference service helpers; production auth and storage remain host-owned.                                              |
| `ai-capability-framework/cli`                                                                                                                                                                                                                               | release-candidate public            | Programmatic CLI runner for tests and tooling. Exposes `runCli` and `CliRunOptions`; not exported from the root package.                                    |
| `src/cli.ts` direct imports in repository tests                                                                                                                                                                                                             | internal but exported for CLI/tests | Source-level test convenience only. External users should import `ai-capability-framework/cli` or run the `aicf` binary.                                    |
| Root `runCli` export                                                                                                                                                                                                                                        | should be removed before v1         | Removed from root in P7. Use `ai-capability-framework/cli`.                                                                                                 |
| CLI implementation helpers other than `runCli` and `CliRunOptions`                                                                                                                                                                                          | should move to subpath              | Keep private to the CLI module unless a future release documents a narrow public contract.                                                                  |
| Undocumented source files, generated internals, and private helper functions                                                                                                                                                                                | should be removed before v1         | Do not expose through package exports.                                                                                                                      |

## Migration Note For Release-Candidate Users

If a release-candidate app imported `runCli` from the package root, change it to:

```ts
import { runCli } from "ai-capability-framework/cli";
```

This keeps root imports focused on the stable Core API while preserving a supported
programmatic CLI entrypoint for tests and local automation.
