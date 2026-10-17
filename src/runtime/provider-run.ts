import { isDeepStrictEqual } from "node:util";
import { performance } from "node:perf_hooks";
import type { BudgetUsage } from "../controls/types.js";
import { executeProviderAttempt } from "./provider-attempt.js";
import type {
  AicfProviderRun, CreateAicfProviderRunOptions, ProviderAttemptInput, ProviderDiagnostic,
  ProviderStageUsage, ProviderTraceMetadata
} from "./provider-types.js";
import { aggregateProviderUsage, freezeProviderValue } from "./provider-usage.js";

const issued = new WeakSet<object>();
export function isAicfProviderRun(value: unknown): value is AicfProviderRun {
  return !!value && typeof value === "object" && issued.has(value);
}

/** One in-process run journal; enforcement remains in the supplied reservation ledger. */
export function createAicfProviderRun(options: CreateAicfProviderRunOptions): AicfProviderRun {
  if (!options.runId?.trim() || !Number.isFinite(options.deadlineAt) || !options.budget?.ledger
    || typeof options.budget.ledger.reserve !== "function" || typeof options.budget.ledger.settle !== "function"
    || !Number.isSafeInteger(options.budget.policy.maxProviderCallsPerRun) || options.budget.policy.maxProviderCallsPerRun! < 1
    || options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new Error("A provider run requires a run ID, deadline and finite budget.");
  const runId = options.runId, deadlineAt = options.deadlineAt, signal = options.signal;
  const budget = Object.freeze({ ledger: options.budget.ledger, policy: freezeProviderValue(structuredClone(options.budget.policy)) });
  const sourcePolicy = options.budget.policy;
  const started = performance.now();
  const records = new Map<string, ProviderStageUsage>();
  const diagnostics: ProviderDiagnostic[] = [];
  const events: import("../observability/types.js").AicfRuntimeTraceEvent[] = [];
  let sequence = 0, broken = false;
  const diagnostic = (code: string) => { if (!diagnostics.some(item => item.code === code) && diagnostics.length < 16) diagnostics.push({ code, message: "A managed provider-run boundary reported a failure." }); };
  const record: AicfProviderRun["record"] = (type, requestId, metadata) => {
    if (events.length >= 256) { diagnostic("trace_overflow"); return; }
    const event = freezeProviderValue({ type, runId: bounded(runId), requestId: bounded(requestId), timestamp: new Date().toISOString(),
      attributes: sanitizeProviderTraceMetadata(metadata) });
    events.push(event);
    try { void Promise.resolve(options.traceSink?.emit(event)).catch(() => diagnostic("trace_sink_failed")); }
    catch { diagnostic("trace_sink_failed"); }
  };
  const snapshot: AicfProviderRun["snapshot"] = () => {
    const stages = [...records.values()];
    const elapsedMs = performance.now() - started;
    return freezeProviderValue({ runId, usage: aggregateProviderUsage(stages, elapsedMs), elapsedMs,
      attemptElapsedMs: stages.reduce((sum, item) => sum + item.elapsedMs, 0), pendingAttempts: stages.filter(item => item.pending).length,
      diagnostics: diagnostics.map(item => ({ ...item })), events: [...events] });
  };
  const run: AicfProviderRun = {
    runId, deadlineAt, signal, budget, record, snapshot,
    async attempt<T, C extends string>(input: Omit<ProviderAttemptInput<T, C>, "runId" | "deadlineAt"> & { runId?: string; deadlineAt?: number }) {
      if (input.runId !== undefined && input.runId !== runId || input.runtimeContext && input.runtimeContext.runId !== runId) throw new Error("Provider run ID mismatch.");
      if (!isDeepStrictEqual(sourcePolicy, budget.policy)) { broken = true; diagnostic("accounting_unavailable"); }
      const attemptId = runId + ":" + ++sequence;
      const signals = [signal, input.signal].filter((item): item is AbortSignal => !!item);
      let lastPending = true;
      return executeProviderAttempt<T, C>({ ...input, runId, deadlineAt: Math.min(deadlineAt, input.deadlineAt ?? Infinity),
        signal: signals.length ? AbortSignal.any(signals) : undefined,
        guard: () => broken ? "accounting_unavailable" as C : input.guard?.()
      }, budget, {
        attemptId,
        accountingFailed() { broken = true; diagnostic("accounting_unavailable"); },
        projectedUsage(requested) {
          const stages = [...records.values()];
          const result: BudgetUsage = { ...requested, runtimeMs: performance.now() - started };
          for (const [key, quantity] of [["inputTokens", "inputTokens"], ["outputTokens", "outputTokens"], ["estimatedCost", "estimatedCost"]] as const)
            result[key] = (requested[key] ?? 0) + stages.reduce((sum, item) => sum + item[quantity].knownSubtotal, 0);
          result.providerCalls = (requested.providerCalls ?? 0) + stages.reduce((sum, item) => sum + item.providerAttempts, 0);
          // The current pending record already represents this attempt after reservation.
          if (records.has(attemptId)) result.providerCalls! -= records.get(attemptId)!.providerAttempts;
          return result;
        },
        update(receipt) {
          const first = !records.has(attemptId);
          records.set(attemptId, freezeProviderValue({ ...receipt, attemptId }));
          if (first || lastPending && !receipt.pending) record(first ? "provider.attempt.start" : "provider.attempt.end", input.requestId, {
            attemptId, stage: receipt.stage, configurationId: receipt.configuration.configurationId, provider: receipt.configuration.provider,
            model: receipt.configuration.model, mock: receipt.mock, outcome: receipt.outcome, reasonCode: receipt.reasonCode, pending: receipt.pending,
            providerAttempts: receipt.providerAttempts, completedResponses: receipt.completedResponses, elapsedMs: receipt.elapsedMs,
            inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens, totalTokens: receipt.totalTokens,
            cachedInputTokens: receipt.cachedInputTokens, reasoningTokens: receipt.reasoningTokens, estimatedCost: receipt.estimatedCost
          });
          lastPending = receipt.pending;
        }
      });
    }
  };
  issued.add(run);
  return Object.freeze(run);
}

export function assertProviderRunScope(run: AicfProviderRun, runId: string, budget?: { ledger: unknown; policy: unknown }): void {
  if (!isAicfProviderRun(run) || run.runId !== runId || budget && (budget.ledger !== run.budget.ledger
    || !isDeepStrictEqual(budget.policy, run.budget.policy))) throw new Error("The provider run and budget scope conflict.");
}

function bounded(value: string): string { return value.slice(0, 160); }
export function sanitizeProviderTraceMetadata(metadata: ProviderTraceMetadata): Record<string, import("../types.js").JsonValue> {
  const result: Record<string, import("../types.js").JsonValue> = {};
  const strings = ["stage", "outcome", "reasonCode", "queryId", "configurationId", "provider", "model", "fingerprint", "corpusFingerprint",
    "indexFingerprint", "retrievalPolicyFingerprint", "eligibilityFingerprint", "attemptId"];
  for (const key of strings) {
    const value = Object.getOwnPropertyDescriptor(metadata, key)?.value;
    if (typeof value === "string") result[key] = bounded(value);
  }
  for (const key of ["candidateCount", "taskCount", "providerAttempts", "completedResponses", "elapsedMs", "pending", "mock"]) {
    const value = Object.getOwnPropertyDescriptor(metadata, key)?.value;
    if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = value;
  }
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "reasoningTokens", "estimatedCost"] as const) {
    const value = Object.getOwnPropertyDescriptor(metadata, key)?.value;
    if (value && typeof value.complete === "boolean" && Number.isFinite(value.knownSubtotal) && value.knownSubtotal >= 0
      && (value.total === null || Number.isFinite(value.total) && value.total >= 0)) result[key] = { total: value.total, knownSubtotal: value.knownSubtotal, complete: value.complete };
  }
  return result;
}
