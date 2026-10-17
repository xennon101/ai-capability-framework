# Stable search-to-tool workflow

Starting with 1.1.0, the recommended lexical/native integration is a **stable public
contract**. Compatible updates preserve the documented imports, request/result fields
and behavior below. Removing or incompatibly changing these contracts requires a major
version. Additive fields and new diagnostics may appear; consumers should tolerate them.

This commitment applies to the named members and configurations, not every export in a
mixed-maturity subpath. It does not guarantee retrieval accuracy for your application.
See the [tested qualification and limits](../evals/discovery-qualification.md).

## Stable members

| Surface                           | Stable members and supported use                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                              | Existing manifest loading, validation, registry and descriptor contracts, including `loadManifests`, `validateManifests`, `buildRegistry` and `toOpenAIResponsesToolName`.                                                                                                                                                                        |
| Discovery                         | `createCapabilityDiscovery` in lexical mode; `search`; `routerFor(result)` using the issued discovery result.                                                                                                                                                                                                                                     |
| Discovery types                   | The lexical fields of `CapabilityDiscoveryOptions`; `CapabilitySearchRequest`, `CapabilityDiscoveryEligibility`, `CapabilityDiscoveryResult`, `RankedCapabilityCandidate`, `CapabilityResultRouter` and their documented standard diagnostics, usage and binding fields. Advanced fields/overloads retain the status below.                       |
| Runtime context and routing       | `AicfRuntimeContext`, `DefaultContextBuilder`, `AicfContextBuilder`, `AicfCapabilityRouter`, `CapabilityRouteRequest`, `CapabilitySlice` and the tool-execution request/result contracts used by the walkthrough.                                                                                                                                 |
| Runtime execution                 | Construction and the demonstrated `register`, `get`, `execute`, `evaluate` and `prepare` operations on `AicfHandlerRegistry`, `AicfToolExecutor`, `AicfActionLifecycleManager` and `DefaultPolicyBroker`; preparation/preview and approval requirements remain supported. Commit/approval administration is outside this newly stabilized subset. |
| Reference stores                  | The approval, idempotency and prepared-action interfaces and `InMemoryApprovalStore`, `InMemoryIdempotencyStore`, `InMemoryPreparedActionStore` used by the read/prepare recipe. These implementations are single-process examples, not durable production storage.                                                                               |
| Ordinary OpenAI-compatible runner | `runOpenAIResponses` with the lexical result router and the basic fields of `AicfOpenAIRunRequest`, `AicfOpenAIRunResult`, `AicfOpenAIResponsesClient`; `MockOpenAIResponsesClient`, `mockFunctionCallResponse` and `mockTextResponse` for deterministic tests. Other provider adapters keep their existing classification.                       |

## Behavior you can rely on

- The minimal discovery configuration needs only a registry. Search accepts ordered task
  IDs/text and existing runtime context, with the documented context-builder,
  eligibility, controls, cancellation and earlier-deadline options.
- Default retrieval is lexical, bounded to eight candidates with positive-score
  admission, no alias bonus/diversity and a 30-second deadline shortened by the caller.
  Search purchases no provider work and never enables hybrid or dedicated selection.
- Results preserve task identity and input order. `matched`, `no_match`, `unavailable`
  and `cancelled` remain distinct. Invalid caller input produces `DiscoveryError`;
  operational outcomes do not choose a fallback candidate automatically.
- Result-bound routers reuse the issued shortlist without ranking or embedding again.
  They reject foreign/reconstructed results and revalidate task, invocation, source,
  eligibility, controls, cancellation and deadline before export and dispatch.
- Runtime validation and authorization govern execution. Preparation can produce a
  preview requiring approval; model-facing routers never expose commit operations.
- Unknown usage remains distinguishable from zero. Fingerprints are opaque, versioned
  compatibility bindings, not confidence estimates or durable request handles.

Applications own decomposition, dependencies, argument completion, authentication,
handler resource access checks and customer responses. No model, credentials, prices,
production database or authorization service is supplied.

## Advanced features retain their boundaries

Dedicated selection is optional and its advanced selector contracts remain
release-candidate public. Hybrid retrieval is **experimental and opt-in**, including
index/client configuration; its incremental-gain qualification gate was not met. Custom
rankers, low-level discovery/index APIs, selection-batch routing, shared provider runs,
tracing, replay and evaluation retain their existing documented maturity. Their presence
on the same facade or subpath does not promote them automatically.

Start with the
[installed-package walkthrough](../getting-started/provider-neutral-quickstart.md). The
[API policy](public-api-policy.md) describes the remaining surfaces.
