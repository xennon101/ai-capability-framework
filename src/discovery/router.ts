import { isDeepStrictEqual } from "node:util";
import type { AicfCapabilityRouter, CapabilityRouteRequest, CapabilitySlice } from "../runtime/types.js";
import { assertProviderRunScope } from "../runtime/provider-run.js";
import { hasOnlyKeys, isRecord } from "./configuration.js";
import { registrySourceFingerprint } from "./corpus.js";
import { CapabilityDiscoverer } from "./discoverer.js";
import { DiscoveryError } from "./diagnostics.js";
import type { CapabilityLexicalRanker, DiscoveryRouteResult, DiscoveryConfiguration, DiscoveryBudgetLedger,
  CapabilitySelectionBatchResult, SelectionModelClient, SelectionLimits, CapabilitySelectionRequest } from "./types.js";
import { exportDiscoveryResult, exportSelectedResult, validateRouterLimit } from "./export.js";
import type { HybridDiscoveryDependencies } from "./embedding-types.js";
import { ModelCapabilitySelector } from "./selection.js";
import { resolveSelectionLimits, resolveSelectionExecution } from "./selection-configuration.js";

export interface RetrievalCapabilityRouteRequest extends CapabilityRouteRequest {
  signal?: AbortSignal;
  deadlineAt?: number;
  budget?: DiscoveryBudgetLedger;
}
/** @inline */
interface RetrievalOptionsBase { discovery: DiscoveryConfiguration; ranker?: CapabilityLexicalRanker; embedding?: HybridDiscoveryDependencies; }
export type RetrievalCapabilityRouterOptions = RetrievalOptionsBase & (
  | { mode: "native_tool_selection"; selection?: never }
  | { mode: "dedicated_selector"; selection: {
    client: SelectionModelClient; limits: SelectionLimits; budgetPolicy?: CapabilitySelectionRequest["budgetPolicy"];
    maxEstimatedCostPerCall?: number; estimateCost?: CapabilitySelectionRequest["estimateCost"];
  } }
);

/** Each route is one task. Revalidation never repeats retrieval or selection. */
export class RetrievalCapabilityRouter implements AicfCapabilityRouter {
  private readonly discoverer: CapabilityDiscoverer;
  private readonly bindings = new WeakMap<CapabilitySlice, (request: RetrievalCapabilityRouteRequest) => DiscoveryRouteResult>();
  private readonly options: RetrievalCapabilityRouterOptions;
  constructor(options: RetrievalCapabilityRouterOptions) {
    if (!isRecord(options as unknown) || !hasOnlyKeys(options as unknown as Record<string, unknown>, ["mode", "discovery", "ranker", "embedding", "selection"])
      || !["native_tool_selection", "dedicated_selector"].includes(options.mode)
      || options.mode === "native_tool_selection" && options.selection !== undefined) throw new DiscoveryError({ code: "invalid_configuration", message: "The retrieval router mode or options are invalid." });
    if (options.mode === "dedicated_selector") {
      if (!options.selection?.client) throw new DiscoveryError({ code: "invalid_configuration", message: "Use native_tool_selection or provide an explicit dedicated selection client and limits." });
      resolveSelectionLimits(options.selection.limits);
    }
    this.options = options;
    this.discoverer = new CapabilityDiscoverer(options.discovery, { ranker: options.ranker, embedding: options.embedding });
  }
  async route(request: RetrievalCapabilityRouteRequest) { return (await this.routeWithDiagnostics(request)).slice; }
  revalidate(request: RetrievalCapabilityRouteRequest, slice: CapabilitySlice): CapabilitySlice {
    const binding = this.bindings.get(slice);
    if (!binding) return { items: [], excluded: [], warnings: [{ code: "stale_binding", message: "The routed slice does not belong to this task invocation." }] };
    const current = binding(request).slice;
    this.bindings.set(current, binding);
    return current;
  }
  async routeWithDiagnostics(request: RetrievalCapabilityRouteRequest): Promise<DiscoveryRouteResult> {
    validateRouterLimit(request.maxCapabilities);
    if (typeof request.userInput.text !== "string") throw new DiscoveryError({ code: "invalid_input", message: "The retrieval router requires string user input." });
    const run = request.providerRun, runtime = request.builtContext.runtimeContext;
    if (run) assertProviderRunScope(run, runtime.runId, request.budget ? { ledger: request.budget,
      policy: this.options.mode === "dedicated_selector" ? this.options.selection.budgetPolicy ?? run.budget.policy : run.budget.policy } : undefined);
    const signals = [request.signal, run?.signal].filter((item): item is AbortSignal => !!item);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    const deadlineAt = Math.min(request.deadlineAt ?? Infinity, run?.deadlineAt ?? Infinity);
    if (this.options.mode === "dedicated_selector") {
      const selection = this.options.selection, budgetPolicy = run?.budget.policy ?? selection.budgetPolicy;
      const budget = request.budget ?? run?.budget.ledger;
      if (!budget || !budgetPolicy || !Number.isFinite(deadlineAt)) throw new DiscoveryError({ code: "invalid_configuration", message: "Dedicated routing requires a shared budget and absolute deadline." });
      resolveSelectionExecution({ ...request, runId: runtime.runId, requestId: runtime.requestId, deadlineAt, registry: request.registry,
        routeRequest: request, tasks: [], client: selection.client, limits: selection.limits, budget, budgetPolicy,
        maxEstimatedCostPerCall: selection.maxEstimatedCostPerCall, estimateCost: selection.estimateCost });
    }
    const selector = this.options.mode === "dedicated_selector" ? this.options.selection : undefined;
    const selectorBinding = selector ? { configuration: structuredClone(selector.client.configuration), mock: selector.client.mock,
      transportVersion: selector.client.transportVersion, limits: structuredClone(selector.limits) } : undefined;
    const routeRequest = { ...request, signal, ...(Number.isFinite(deadlineAt) ? { deadlineAt } : {}) };
    const initialSource = registrySourceFingerprint(request.registry), context = structuredClone(runtime);
    const text = request.userInput.text, registry = request.registry, controls = request.controls;
    const current = (next: CapabilityRouteRequest) => next.registry === registry && isDeepStrictEqual(next.builtContext.runtimeContext, context)
      && (!selector || isDeepStrictEqual(selectorBinding, { configuration: selector.client.configuration, mock: selector.client.mock, transportVersion: selector.client.transportVersion, limits: selector.limits }))
      && isDeepStrictEqual(runtime, context) && next.userInput.text === text && next.controls === controls && (!next.providerRun || next.providerRun === run);
    const discovery = [...await this.discoverer.discover({ routeRequest, queries: [{ id: runtime.requestId, fragments: [{ key: "user_input", text }] }],
      runId: runtime.runId, requestId: runtime.requestId, signal, deadlineAt: routeRequest.deadlineAt,
      budget: request.budget ?? run?.budget.ledger, providerRun: run,
      maxCandidates: Math.min(request.maxCapabilities ?? this.discoverer.configuration.limits.maxCandidates, this.discoverer.configuration.limits.maxCandidates)
    })];
    let selection: CapabilitySelectionBatchResult | undefined;
    if (this.options.mode === "dedicated_selector") {
      const selectionOptions = this.options.selection, budgetPolicy = run?.budget.policy ?? selectionOptions.budgetPolicy;
      const budget = request.budget ?? run?.budget.ledger;
      if (!budget || !budgetPolicy || !Number.isFinite(deadlineAt)) throw new DiscoveryError({ code: "invalid_configuration", message: "Dedicated routing requires a shared budget and absolute deadline." });
      selection = await new ModelCapabilitySelector().select({ tasks: [{ queryId: discovery[0]!.queryId, requestText: text, discovery: discovery[0]! }],
        registry, routeRequest, runId: runtime.runId, requestId: runtime.requestId, deadlineAt, signal, providerRun: run,
        client: selectionOptions.client, limits: selectionOptions.limits, budget, budgetPolicy,
        maxEstimatedCostPerCall: selectionOptions.maxEstimatedCostPerCall, estimateCost: selectionOptions.estimateCost, isCurrent: () => current(request) });
    }
    const binding = (next: RetrievalCapabilityRouteRequest) => {
      const nextSignals = [signal, next.signal].filter((item): item is AbortSignal => !!item);
      const bounded = { ...next, signal: nextSignals.length ? AbortSignal.any(nextSignals) : undefined,
        deadlineAt: Math.min(routeRequest.deadlineAt ?? Infinity, next.deadlineAt ?? Infinity) };
      return selection ? exportSelectedResult(bounded, discovery[0]!, selection, initialSource, current(next))
        : exportDiscoveryResult(bounded, discovery[0]!, initialSource, current(next));
    };
    const result = binding(request);
    this.bindings.set(result.slice, binding);
    run?.record("discovery.end", runtime.requestId, { queryId: discovery[0]!.queryId, outcome: discovery[0]!.status,
      candidateCount: discovery[0]!.candidates.length, corpusFingerprint: discovery[0]!.corpusFingerprint,
      retrievalPolicyFingerprint: discovery[0]!.retrievalPolicyFingerprint, eligibilityFingerprint: discovery[0]!.eligibilityFingerprint });
    if (selection) run?.record("selection.end", runtime.requestId, { taskCount: 1, outcome: selection.outcomes[0]?.status });
    return result;
  }
}
