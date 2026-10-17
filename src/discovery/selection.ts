import { assertProviderRunScope } from "../runtime/provider-run.js";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { captureEligibility } from "./bindings.js";
import { hasOnlyKeys, isRecord, nonblank } from "./configuration.js";
import { registrySourceFingerprint } from "./corpus.js";
import { DiscoveryError, type DiscoveryDiagnosticCode } from "./diagnostics.js";
import { stopReason, validateProviderInvocation } from "./embeddings.js";
import { hashDiscoveryContent } from "./fingerprint.js";
import { deepFreeze } from "./json-snapshot.js";
import { runSelectionAttempt } from "./selection-attempt.js";
import { buildCapabilitySelectionTasks } from "./selection-cards.js";
import { resolveSelectionExecution, selectionError, selectionJson } from "./selection-configuration.js";
import { SELECTION_OUTPUT_SCHEMA, selectionMessages } from "./selection-response.js";
import type {
  CapabilitySelectionBatchResult, CapabilitySelectionInputTask, CapabilitySelectionOutcome, CapabilitySelectionRequest,
  DiscoveryStageUsage, SelectionTask
} from "./types.js";
import { aggregateDiscoveryUsage } from "./usage.js";
import { SELECTION_HARD_LIMITS } from "./versions.js";

/** This optional stage only returns decisions. It never exports tools or executes a handler. */
export class ModelCapabilitySelector {
  async select(input: CapabilitySelectionRequest): Promise<CapabilitySelectionBatchResult> {
    if (!isRecord(input as unknown) || !hasOnlyKeys(input as unknown as Record<string, unknown>, [
      "runId", "requestId", "deadlineAt", "signal", "tasks", "registry", "routeRequest", "client", "limits", "budget",
      "budgetPolicy", "maxEstimatedCostPerCall", "estimateCost", "isCurrent", "providerRun"
    ]) || !Array.isArray(input.tasks) || !input.routeRequest || input.registry !== input.routeRequest.registry
      || input.isCurrent !== undefined && typeof input.isCurrent !== "function") throw selectionError("invalid_input");
    // Pin invocation bounds and dependencies while continuing to observe live authorization/source objects.
    if (input.providerRun) assertProviderRunScope(input.providerRun, input.runId, { ledger: input.budget, policy: input.budgetPolicy });
    const signals = [input.signal, input.providerRun?.signal].filter((item): item is AbortSignal => !!item);
    const request = Object.freeze({ ...input, signal: signals.length ? AbortSignal.any(signals) : undefined,
      deadlineAt: Math.min(input.deadlineAt, input.providerRun?.deadlineAt ?? Infinity) });
    try { validateProviderInvocation(request); } catch { throw selectionError("invalid_configuration"); }
    const resolved = resolveSelectionExecution(request);
    if (request.tasks.length > SELECTION_HARD_LIMITS.maxTasks) throw selectionError("input_limit_exceeded");
    const ids = new Set<string>();
    for (const task of request.tasks) {
      if (!task || !nonblank(task.queryId) || ids.has(task.queryId) || !task.discovery || task.queryId !== task.discovery.queryId) throw selectionError("invalid_input");
      ids.add(task.queryId);
    }
    const started = performance.now();
    const discovery = selectionJson(request.tasks.map(task => task.discovery), SELECTION_HARD_LIMITS.maxInputCharacters * 4);
    const matched = request.tasks.filter(task => task.discovery.status === "matched").map(task => ({ queryId: task.queryId }));
    const stages: DiscoveryStageUsage[] = [];
    let tasks: readonly SelectionTask[] = [];
    const finish = (outcomes: readonly CapabilitySelectionOutcome[], code?: DiscoveryDiagnosticCode): CapabilitySelectionBatchResult => deepFreeze({
      discovery, outcomes, usage: aggregateDiscoveryUsage(stages, performance.now() - started),
      diagnostics: code ? [{ code, message: "The selection batch did not produce actionable decisions." }] : []
    });
    const failure = (code: DiscoveryDiagnosticCode) => finish(matched.map(task => ({
      queryId: task.queryId, selectorFingerprint: resolved.fingerprint,
      inputBindingHash: tasks.find(entry => entry.queryId === task.queryId)?.inputBindingHash
        ?? hashDiscoveryContent({ kind: "unavailable_selection_input", queryId: task.queryId, selectorFingerprint: resolved.fingerprint }),
      status: code === "cancelled" || code === "deadline_exceeded" ? "cancelled" as const
        : code === "invalid_selection_output" ? "invalid_output" as const : "unavailable" as const,
      capabilityId: null, reasonCode: code,
      diagnostics: [{ code, queryId: task.queryId, message: "Selection was cancelled, unavailable, or invalid; no capability was chosen." }]
    })), code);
    if (!request.tasks.length) return finish([]);
    if (request.tasks.length > resolved.limits.maxTasks) return failure("input_limit_exceeded");
    let source: string, eligibility: string;
    let snapshot: readonly CapabilitySelectionInputTask[], context: unknown;
    try {
      snapshot = selectionJson(request.tasks, SELECTION_HARD_LIMITS.maxInputCharacters * 4);
      context = structuredClone(request.routeRequest.builtContext.runtimeContext);
      source = registrySourceFingerprint(request.registry);
      eligibility = captureEligibility(request.routeRequest).fingerprint;
    } catch (error) { return failure(error instanceof DiscoveryError ? error.code : "invalid_selection_input"); }
    const runtime = request.routeRequest.builtContext.runtimeContext;
    if (request.runId !== runtime.runId || request.requestId !== runtime.requestId) return failure("stale_binding");
    const hostGuard = request.isCurrent;
    const controls = request.routeRequest.controls;
    const current = () => {
      try { return isDeepStrictEqual(context, request.routeRequest.builtContext.runtimeContext)
        && isDeepStrictEqual(snapshot, request.tasks) && request.routeRequest.controls === controls
        && registrySourceFingerprint(request.registry) === source && captureEligibility(request.routeRequest).fingerprint === eligibility
        && (hostGuard?.() ?? true); }
      catch { return false; }
    };
    const stopped = stopReason(request);
    if (stopped) return failure(stopped);
    if (!matched.length) return finish([]);
    try {
      tasks = buildCapabilitySelectionTasks({ tasks: snapshot, routeRequest: request.routeRequest,
        selectorFingerprint: resolved.fingerprint, maxInputCharacters: resolved.limits.maxInputCharacters });
    } catch (error) { return failure(error instanceof DiscoveryError ? error.code : "invalid_selection_input"); }
    const submitted = tasks.filter(task => task.discovery.status === "matched");
    let issues: readonly string[] = [];
    for (let attempt = 1; attempt <= resolved.limits.maxAttempts; attempt++) {
      let messages;
      try {
        messages = selectionJson(selectionMessages(submitted, issues), resolved.limits.maxInputCharacters);
        selectionJson({ messages, outputSchema: SELECTION_OUTPUT_SCHEMA, maxInputTokens: resolved.limits.maxInputTokens,
          maxOutputTokens: resolved.limits.maxOutputTokens }, resolved.limits.maxInputCharacters);
      } catch { return failure("input_limit_exceeded"); }
      const result = await runSelectionAttempt({ request, resolved, tasks: submitted, messages, attempt: attempt as 1 | 2, isCurrent: current });
      stages.push(...result.usage.stages);
      if (result.code) {
        if (result.code === "invalid_selection_output" && attempt < resolved.limits.maxAttempts) { issues = result.issues; continue; }
        return failure(result.code);
      }
      const stop = stopReason(request); if (stop) return failure(stop);
      if (!current()) return failure("stale_binding");
      const decisions = new Map(result.decisions!.map(decision => [decision.query_id, decision]));
      return finish(submitted.map(task => {
        const decision = decisions.get(task.queryId)!;
        const base = { queryId: task.queryId, selectorFingerprint: resolved.fingerprint, inputBindingHash: task.inputBindingHash, diagnostics: [] };
        return decision.decision === "select" ? { ...base, status: "selected" as const, capabilityId: decision.capability_id,
          capabilityVersion: task.cards.find(card => card.capabilityId === decision.capability_id)!.capabilityVersion, reasonCode: "supported_candidate" as const }
          : { ...base, status: "abstained" as const, capabilityId: null, reasonCode: decision.reason_code };
      }));
    }
    return failure("invalid_selection_output");
  }
}
