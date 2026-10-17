import { assertProviderRunScope } from "../runtime/provider-run.js";
import type { AicfProviderRun } from "../runtime/provider-types.js";
import { isDeepStrictEqual } from "node:util";
import { DefaultContextBuilder } from "../runtime/context.js";
import type { AicfCapabilityRouter, AicfContextBuilder, AicfRuntimeContext, CapabilityRouteRequest } from "../runtime/types.js";
import type { ManifestRegistry } from "../types.js";
import type { DiscoveryBudgetScope } from "./budget.js";
import { hasOnlyKeys, isRecord, nonblank, resolveDiscoveryConfiguration } from "./configuration.js";
import { registrySourceFingerprint } from "./corpus.js";
import { CapabilityDiscoverer, validateQueries } from "./discoverer.js";
import { DiscoveryError } from "./diagnostics.js";
import { positiveInteger, resolveIndexLimits } from "./embedding-configuration.js";
import type { EmbeddingExecutionOptions, EmbeddingIndexLimits } from "./embedding-types.js";
import { exportDiscoveryResult, exportSelectedResult, validateRouterLimit } from "./export.js";
import { boundedJsonSnapshot, deepFreeze } from "./json-snapshot.js";
import { ModelCapabilitySelector } from "./selection.js";
import { resolveSelectionLimits } from "./selection-configuration.js";
import type { CapabilitySelectRequest } from "./selection-types.js";
import { aggregateDiscoveryUsage } from "./usage.js";
import { SELECTION_HARD_LIMITS } from "./versions.js";
import type {
  CapabilityDiscoveryResult, CapabilityLexicalRanker, CapabilitySelectionBatchResult, DiscoveryConfiguration,
  DiscoveryLimits, DiscoveryRouteResult, EmbeddingClient, HybridDiscoveryConfiguration
} from "./types.js";

export const DISCOVERY_STANDARD_PROFILE = deepFreeze({
  policyVersion: "aicf.discovery.standard.v1", timeoutMs: 30_000,
  weights: { semantic: 0.75, lexical: 0.25 }, failurePolicy: "unavailable" as const,
  indexLimits: { maxArtifactBytes: 16 * 1024 * 1024, maxEntries: 10_000, maxVectorDimension: 4_096 },
  maxCharactersPerText: 16_384, maxCharactersPerCall: 65_536
});

/** @inline */
interface CapabilityDiscoveryOptionsBase {
  registry: ManifestRegistry;
  contextBuilder?: AicfContextBuilder;
  ranker?: CapabilityLexicalRanker;
  policyVersion?: string;
  timeoutMs?: number;
  limits?: Partial<DiscoveryLimits>;
  aliasWeight?: number;
  minRetrievalScore?: number;
}

export interface CapabilityDiscoveryEmbeddingOptions {
  client: EmbeddingClient;
  index: unknown;
  maxInputTokens: number;
  indexLimits?: Partial<EmbeddingIndexLimits>;
  maxCharactersPerText?: number;
  maxCharactersPerCall?: number;
  maxEstimatedCostPerCall?: number;
  estimateCost?: EmbeddingExecutionOptions["estimateCost"];
}

export type CapabilityDiscoveryOptions = CapabilityDiscoveryOptionsBase & (
  | { mode?: "lexical"; embedding?: never; weights?: never; failurePolicy?: never }
  | { mode: "hybrid"; embedding: CapabilityDiscoveryEmbeddingOptions;
      weights?: HybridDiscoveryConfiguration["weights"]; failurePolicy?: HybridDiscoveryConfiguration["failurePolicy"] }
);

export type CapabilityDiscoveryEligibility = Omit<CapabilityRouteRequest, "registry" | "builtContext" | "userInput" | "controls">;
export interface CapabilitySearchRequest {
  providerRun?: AicfProviderRun;
  tasks: readonly { id: string; text: string }[];
  runtimeContext: AicfRuntimeContext;
  controls?: CapabilityRouteRequest["controls"];
  eligibility?: CapabilityDiscoveryEligibility;
  signal?: AbortSignal;
  deadlineAt?: number;
  budget?: DiscoveryBudgetScope;
}

export interface CapabilityResultRouter extends AicfCapabilityRouter {
  routeWithDiagnostics(request: CapabilityRouteRequest): DiscoveryRouteResult;
}

export interface CapabilityDiscovery {
  search(request: CapabilitySearchRequest): Promise<readonly CapabilityDiscoveryResult[]>;
  select(request: CapabilitySelectRequest): Promise<CapabilitySelectionBatchResult>;
  routerFor(result: CapabilityDiscoveryResult): CapabilityResultRouter;
  routerFor(batch: CapabilitySelectionBatchResult, queryId: string): CapabilityResultRouter;
}

const eligibilityKeys = [
  "allowedCapabilityTypes", "allowedDomains", "capabilityPermissions", "excludeCapabilityIds", "includeCapabilityIds",
  "includeDeprecated", "includeDisabledForTests", "includeDraft", "includeExperimental", "includeRestricted",
  "maxCapabilities", "maxRiskTier"
] as const;

function validateEligibility(value: CapabilityDiscoveryEligibility): void {
  const invalid = () => new DiscoveryError({ code: "invalid_input", message: "Discovery eligibility options are invalid." });
  for (const key of ["allowedCapabilityTypes", "allowedDomains", "excludeCapabilityIds", "includeCapabilityIds"] as const) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || !value[key]!.every(nonblank))) throw invalid();
  }
  for (const key of ["includeDeprecated", "includeDisabledForTests", "includeDraft", "includeExperimental", "includeRestricted"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw invalid();
  }
  if (value.maxRiskTier !== undefined && !["low", "medium", "high", "critical"].includes(value.maxRiskTier)) throw invalid();
  if (value.capabilityPermissions !== undefined) {
    if (!isRecord(value.capabilityPermissions)) throw invalid();
    for (const permission of Object.values(value.capabilityPermissions)) {
      if (!isRecord(permission) || !hasOnlyKeys(permission, ["allowed", "permissions", "reason"])
        || typeof permission.allowed !== "boolean" || !Array.isArray(permission.permissions)
        || !permission.permissions.every(nonblank) || permission.reason !== undefined && typeof permission.reason !== "string") throw invalid();
    }
  }
  validateRouterLimit(value.maxCapabilities);
}

/** Simple application-driven search. Model choice and execution stay in the ordinary runtime. */
export function createCapabilityDiscovery(options: CapabilityDiscoveryOptions): CapabilityDiscovery {
  const invalid = () => new DiscoveryError({ code: "invalid_configuration", message: "The discovery facade configuration is invalid." });
  if (!isRecord(options) || !hasOnlyKeys(options, ["registry", "contextBuilder", "ranker", "policyVersion", "timeoutMs",
    "limits", "aliasWeight", "minRetrievalScore", "mode", "embedding", "weights", "failurePolicy"])
    || Object.values(options).some(value => value === null)
    || !options.registry || options.contextBuilder !== undefined && typeof options.contextBuilder?.build !== "function") throw invalid();
  const timeoutMs = options.timeoutMs ?? DISCOVERY_STANDARD_PROFILE.timeoutMs;
  if (!positiveInteger(timeoutMs)) throw invalid();
  const registry = options.registry;
  const contextBuilder = options.contextBuilder ?? new DefaultContextBuilder();
  const base = { policyVersion: options.policyVersion ?? DISCOVERY_STANDARD_PROFILE.policyVersion,
    limits: options.limits, aliasWeight: options.aliasWeight, minRetrievalScore: options.minRetrievalScore };
  const configuration: DiscoveryConfiguration = options.mode === "hybrid"
    ? { ...base, mode: "hybrid", weights: options.weights ?? DISCOVERY_STANDARD_PROFILE.weights,
        failurePolicy: options.failurePolicy ?? DISCOVERY_STANDARD_PROFILE.failurePolicy }
    : { ...base, mode: options.mode ?? "lexical" };
  const resolved = resolveDiscoveryConfiguration(configuration);
  const ranker = options.ranker;
  // Validate even before the first search; the low-level engine remains strict and explicit.
  const lexicalEngine = new CapabilityDiscoverer({ ...base, mode: "lexical" }, { ranker });
  let embedding: CapabilityDiscoveryEmbeddingOptions | undefined;
  let indexLimits: EmbeddingIndexLimits | undefined;
  if (options.mode === "hybrid") {
    const value = options.embedding;
    if (!isRecord(value) || !hasOnlyKeys(value, ["client", "index", "maxInputTokens", "indexLimits", "maxCharactersPerText",
      "maxCharactersPerCall", "maxEstimatedCostPerCall", "estimateCost"])
      || !positiveInteger(value.maxInputTokens) || !value.client || typeof value.client.embed !== "function"
      || typeof value.client.mock !== "boolean" || value.indexLimits !== undefined && !isRecord(value.indexLimits)) throw invalid();
    embedding = { ...value };
    indexLimits = resolveIndexLimits({ ...DISCOVERY_STANDARD_PROFILE.indexLimits, ...value.indexLimits });
    for (const key of ["maxCharactersPerText", "maxCharactersPerCall"] as const) {
      if (value[key] !== undefined && !positiveInteger(value[key])) throw invalid();
    }
  } else if (options.embedding !== undefined || options.weights !== undefined || options.failurePolicy !== undefined) throw invalid();

  interface Binding {
    providerRun?: AicfProviderRun;
    source: string;
    taskText: string;
    context: AicfRuntimeContext;
    liveContext: AicfRuntimeContext;
    eligibility: CapabilityDiscoveryEligibility;
    controls: CapabilityRouteRequest["controls"];
    builtContext: CapabilityRouteRequest["builtContext"];
    signal?: AbortSignal;
    deadlineAt: number;
  }
  // Entries live only as long as the caller retains the issued result. This is not a retrieval cache.
  const bindings = new WeakMap<CapabilityDiscoveryResult, Binding>();
  const batches = new WeakMap<CapabilitySelectionBatchResult, { results: readonly CapabilityDiscoveryResult[];
    current: () => boolean; signal?: AbortSignal; deadlineAt: number; providerRun?: AicfProviderRun }>();
  return Object.freeze({
    async search(request: CapabilitySearchRequest) {
      if (!isRecord(request) || !hasOnlyKeys(request, ["tasks", "runtimeContext", "controls", "eligibility", "signal", "deadlineAt", "budget", "providerRun"])
        || !Array.isArray(request.tasks) || !request.runtimeContext
        || request.controls !== undefined && typeof request.controls?.evaluate !== "function"
        || request.deadlineAt !== undefined && !Number.isFinite(request.deadlineAt)
        || request.signal !== undefined && !(request.signal instanceof AbortSignal)
        || request.eligibility !== undefined && (!isRecord(request.eligibility) || !hasOnlyKeys(request.eligibility, eligibilityKeys))) {
        throw new DiscoveryError({ code: "invalid_input", message: "Search requires tasks, runtime context, and valid request options." });
      }
      if (request.tasks.length > resolved.limits.maxQueries) throw new DiscoveryError({ code: "input_limit_exceeded", message: "The task batch exceeds the configured limit." });
      const queries = Array.from(request.tasks, task => {
        if (!isRecord(task) || !hasOnlyKeys(task, ["id", "text"]) || !nonblank(task.id) || typeof task.text !== "string") {
          throw new DiscoveryError({ code: "invalid_input", message: "Tasks require unique nonblank IDs and string text." });
        }
        return { id: task.id, fragments: [{ key: "task", text: task.text }] };
      });
      // Reuse the engine's bounds and snapshot validation before invoking application code.
      validateQueries({ queries }, resolved);
      if (!queries.length) return Object.freeze([]);
      const eligibility = request.eligibility ?? {};
      validateEligibility(eligibility);
      if (request.providerRun) assertProviderRunScope(request.providerRun, request.runtimeContext.runId, request.budget);
      const budget = request.budget ?? request.providerRun?.budget;
      const signals = [request.signal, request.providerRun?.signal].filter((item): item is AbortSignal => !!item);
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      const deadlineAt = Math.min(Date.now() + timeoutMs, request.deadlineAt ?? Infinity, request.providerRun?.deadlineAt ?? Infinity);
      let context: AicfRuntimeContext;
      try { context = structuredClone(request.runtimeContext); }
      catch { throw new DiscoveryError({ code: "invalid_input", message: "The runtime context cannot be bound to discovery." }); }
      const source = registrySourceFingerprint(registry);
      const builtContext = await contextBuilder.build({ baseContext: request.runtimeContext, registry,
        // This context-only sentinel never enters retrieval or provider input.
        userInput: { text: queries.find(query => query.fragments[0]!.text.trim())?.fragments[0]!.text ?? "[empty discovery query]" } });
      const routeRequest: CapabilityRouteRequest = { ...eligibility, controls: request.controls, registry, builtContext,
        userInput: { text: queries[0]!.fragments[0]!.text } };
      let engine = lexicalEngine;
      if (embedding) {
        if (!budget || !isRecord(budget) || !hasOnlyKeys(budget, ["ledger", "policy"])
          || !Number.isSafeInteger(budget.policy?.maxInputTokensPerRun)
          || budget.policy.maxInputTokensPerRun! < 0) throw invalid();
        engine = new CapabilityDiscoverer(resolved, { ranker, embedding: {
          client: embedding.client, index: embedding.index, indexLimits: indexLimits!, execution: {
            budgetPolicy: budget.policy, estimateCost: embedding.estimateCost,
            limits: { maxInputTokens: embedding.maxInputTokens,
              maxCharactersPerText: embedding.maxCharactersPerText ?? DISCOVERY_STANDARD_PROFILE.maxCharactersPerText,
              maxCharactersPerCall: embedding.maxCharactersPerCall ?? DISCOVERY_STANDARD_PROFILE.maxCharactersPerCall,
              ...(embedding.maxEstimatedCostPerCall === undefined ? {} : { maxEstimatedCostPerCall: embedding.maxEstimatedCostPerCall }) }
          }
        } });
      }
      const results = await engine.discover({ routeRequest, queries, runId: context.runId, requestId: context.requestId,
        deadlineAt, signal, budget: budget?.ledger, providerRun: request.providerRun,
        maxCandidates: Math.min(eligibility.maxCapabilities ?? resolved.limits.maxCandidates, resolved.limits.maxCandidates) });
      return Object.freeze(results.map((result, index) => {
        const current = isDeepStrictEqual(context, request.runtimeContext) && isDeepStrictEqual(context, builtContext.runtimeContext);
        const issued = deepFreeze(exportDiscoveryResult({ ...routeRequest, deadlineAt, signal }, result, source, current).discovery[0]!);
        bindings.set(issued, { source, taskText: queries[index]!.fragments[0]!.text, context,
          liveContext: request.runtimeContext, eligibility, controls: request.controls, builtContext, signal, deadlineAt, providerRun: request.providerRun });
        request.providerRun?.record("discovery.end", context.requestId, { queryId: issued.queryId, outcome: issued.status,
          candidateCount: issued.candidates.length, reasonCode: issued.diagnostics[0]?.code, corpusFingerprint: issued.corpusFingerprint, indexFingerprint: issued.indexFingerprint,
          retrievalPolicyFingerprint: issued.retrievalPolicyFingerprint, eligibilityFingerprint: issued.eligibilityFingerprint });
        return issued;
      }));
    },
    async select(request: CapabilitySelectRequest) {
      const invalidInput = () => new DiscoveryError({ code: "invalid_input", message: "Selection requires issued results from one compatible invocation and scope." });
      if (!isRecord(request as unknown) || !hasOnlyKeys(request as unknown as Record<string, unknown>, ["results", "client", "budget", "maxInputTokens", "maxOutputTokens",
        "contextByQueryId", "limits", "maxEstimatedCostPerCall", "estimateCost", "signal", "deadlineAt", "providerRun"])
        || !Array.isArray(request.results) || request.signal !== undefined && !(request.signal instanceof AbortSignal)
        || request.deadlineAt !== undefined && !Number.isFinite(request.deadlineAt)
        || request.contextByQueryId !== undefined && !isRecord(request.contextByQueryId)) throw invalidInput();
      const limits = resolveSelectionLimits({ ...request.limits, maxInputTokens: request.maxInputTokens, maxOutputTokens: request.maxOutputTokens });
      if (request.limits !== undefined && (!isRecord(request.limits) || !hasOnlyKeys(request.limits, ["maxTasks", "maxInputCharacters", "maxAttempts"]))) throw invalidInput();
      if (request.results.length > SELECTION_HARD_LIMITS.maxTasks) throw new DiscoveryError({ code: "input_limit_exceeded", message: "The selection batch exceeds the hard task limit." });
      const records = Array.from(request.results, result => { const record = bindings.get(result); if (!record) throw invalidInput(); return record; });
      const queryIds = new Set(request.results.map(result => result.queryId));
      if (queryIds.size !== request.results.length || Reflect.ownKeys(request.contextByQueryId ?? {}).some(id => typeof id !== "string" || !queryIds.has(id))) throw invalidInput();
      const projections = Object.getOwnPropertyDescriptors(request.contextByQueryId ?? {});
      if (Object.values(projections).some(property => !property.enumerable || !("value" in property))) throw invalidInput();
      if (!records.length) return deepFreeze({ discovery: [], outcomes: [], diagnostics: [], usage: aggregateDiscoveryUsage([], 0) });
      const first = records[0]!;
      if (records.some(record => !isDeepStrictEqual(record.context, first.context) || !isDeepStrictEqual(record.eligibility, first.eligibility)
        || record.controls !== first.controls || record.providerRun !== first.providerRun)) throw invalidInput();
      const providerRun = request.providerRun ?? first.providerRun;
      if (request.providerRun && first.providerRun && request.providerRun !== first.providerRun) throw invalidInput();
      if (providerRun) assertProviderRunScope(providerRun, first.context.runId, request.budget);
      const budget = request.budget ?? providerRun?.budget;
      if (!budget || !isRecord(budget) || !hasOnlyKeys(budget, ["ledger", "policy"])) throw invalidInput();
      const signals = [request.signal, providerRun?.signal, ...records.map(record => record.signal)].filter((signal): signal is AbortSignal => signal !== undefined);
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      const deadlineAt = Math.min(request.deadlineAt ?? Infinity, providerRun?.deadlineAt ?? Infinity, ...records.map(record => record.deadlineAt));
      const model = structuredClone(request.client.configuration), mock = request.client.mock, transportVersion = request.client.transportVersion;
      let projectedContext: unknown;
      try { projectedContext = boundedJsonSnapshot(request.contextByQueryId ?? {}, SELECTION_HARD_LIMITS.maxInputCharacters * 4); }
      catch { /* The selector returns a bounded invalid-input outcome without reading accessors. */ }
      const originalResults = [...request.results];
      const current = () => records.every(record => isDeepStrictEqual(record.context, record.liveContext))
        && isDeepStrictEqual(model, request.client.configuration) && mock === request.client.mock && transportVersion === request.client.transportVersion
        && isDeepStrictEqual(projectedContext, request.contextByQueryId ?? {});
      const batch = await new ModelCapabilitySelector().select({
        tasks: request.results.map((result, index) => ({ queryId: result.queryId, requestText: records[index]!.taskText,
          ...(Object.hasOwn(projections, result.queryId) ? { context: projections[result.queryId]!.value } : {}), discovery: result })),
        registry, routeRequest: { ...first.eligibility, controls: first.controls, registry, builtContext: first.builtContext,
          userInput: { text: first.taskText } }, runId: first.context.runId, requestId: first.context.requestId,
        deadlineAt, signal, providerRun,
        client: request.client, budget: budget.ledger, budgetPolicy: budget.policy, limits,
        maxEstimatedCostPerCall: request.maxEstimatedCostPerCall, estimateCost: request.estimateCost,
        isCurrent: current
      });
      batches.set(batch, { results: originalResults, current, deadlineAt, signal, providerRun });
      providerRun?.record("selection.end", first.context.requestId, { taskCount: batch.outcomes.length, reasonCode: batch.diagnostics[0]?.code, outcome: batch.diagnostics.length ? "unavailable" : "completed" });
      return batch;
    },
    routerFor(value: CapabilityDiscoveryResult | CapabilitySelectionBatchResult, queryId?: string) {
      const batch = queryId === undefined ? undefined : value as CapabilitySelectionBatchResult;
      const selectionBinding = batch && batches.get(batch);
      if (batch && !selectionBinding) throw new DiscoveryError({ code: "invalid_input", message: "The selection batch was not issued by this facade." });
      const result = batch ? selectionBinding!.results.find(result => result.queryId === queryId)! : value as CapabilityDiscoveryResult;
      const binding = result && bindings.get(result);
      if (!binding) throw new DiscoveryError({ code: "invalid_input", message: "The result was not issued by this discovery instance." });
      const routeWithDiagnostics = (request: CapabilityRouteRequest): DiscoveryRouteResult => {
        validateRouterLimit(request.maxCapabilities);
        // A runner may omit search filters, but may never replace them with broader ones.
        let current = request.registry === registry && (selectionBinding?.current() ?? true) && isDeepStrictEqual(binding.context, request.builtContext.runtimeContext)
          && isDeepStrictEqual(binding.context, binding.liveContext) && request.userInput.text === binding.taskText
          && (!binding.controls || !request.controls || request.controls === binding.controls)
          && (!request.providerRun || request.providerRun === (selectionBinding?.providerRun ?? binding.providerRun));
        for (const key of eligibilityKeys) {
          if (key !== "maxCapabilities" && request[key] !== undefined && binding.eligibility[key] !== undefined
            && !isDeepStrictEqual(request[key], binding.eligibility[key])) current = false;
        }
        const limit = Math.min(request.maxCapabilities ?? 20, binding.eligibility.maxCapabilities ?? 20);
        const signals = [request.signal, selectionBinding?.signal ?? binding.signal].filter((item): item is AbortSignal => !!item);
        const routeRequest = { ...request, maxCapabilities: limit,
          controls: request.controls ?? binding.controls, signal: signals.length ? AbortSignal.any(signals) : undefined,
          deadlineAt: Math.min(request.deadlineAt ?? Infinity, selectionBinding?.deadlineAt ?? binding.deadlineAt) };
        for (const key of eligibilityKeys) {
          if (key !== "maxCapabilities" && request[key] === undefined) Object.assign(routeRequest, { [key]: binding.eligibility[key] });
        }
        return batch ? exportSelectedResult(routeRequest, result, batch, binding.source, current)
          : exportDiscoveryResult(routeRequest, result, binding.source, current);
      };
      return Object.freeze({ providerRun: selectionBinding?.providerRun ?? binding.providerRun, routeWithDiagnostics, route: (request: CapabilityRouteRequest) => routeWithDiagnostics(request).slice,
        revalidate: (request: CapabilityRouteRequest) => routeWithDiagnostics(request).slice });
    }
  });
}
