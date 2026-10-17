import { performance } from "node:perf_hooks";
import type { BudgetUsage } from "../controls/types.js";
import { stopGate, stopReason } from "./provider-stop.js";
import type {
  ProviderAttemptInput, ProviderAttemptResult, ProviderBudgetScope, ProviderFailureCode,
  ProviderStageUsage, ProviderUsage, ModelUsage
} from "./provider-types.js";
import { aggregateProviderUsage, knownUsage, ownValue, usageQuantities, validReportedUsage } from "./provider-usage.js";

export interface ProviderAttemptObserver {
  attemptId?: string;
  update(receipt: ProviderStageUsage): void;
  accountingFailed(): void;
  projectedUsage(requested: BudgetUsage): BudgetUsage;
}

/** A single attempt. The completion remains observed after the caller's cancellation race. */
export async function executeProviderAttempt<T, C extends string>(
  input: ProviderAttemptInput<T, C>, budget: ProviderBudgetScope, observer?: ProviderAttemptObserver
): Promise<ProviderAttemptResult<T, C>> {
  const request = Object.freeze({ ...input, configuration: Object.freeze({ ...input.configuration }) });
  if (!request.runId?.trim() || !request.requestId?.trim() || !Number.isFinite(request.deadlineAt)
    || !validConfiguration(request.configuration, request.stage)
    || !positive(request.attempt ?? 1)
    || !positive(request.maxInputTokens) || !["embedding_build", "query_embedding"].includes(request.stage) && !positive(request.maxOutputTokens)
    || request.maxOutputTokens !== undefined && !positive(request.maxOutputTokens)
    || typeof request.mock !== "boolean" || !Number.isSafeInteger(budget.policy.maxProviderCallsPerRun) || budget.policy.maxProviderCallsPerRun! < 0
    || !budget.ledger || typeof budget.ledger.reserve !== "function" || typeof budget.ledger.settle !== "function"
    || request.maxEstimatedCostPerCall !== undefined && !nonnegative(request.maxEstimatedCostPerCall)
    || budget.policy.maxEstimatedCostPerRun !== undefined && request.maxEstimatedCostPerCall === undefined) {
    throw new Error("Provider attempts require valid invocation bounds, token limits and a finite shared budget.");
  }
  const started = performance.now();
  let attempted = false;
  let reasonCode: string | undefined;
  let progress = { usage: {} as ModelUsage, providerAttempts: 1, completedResponses: 0 };
  const attempt = request.attempt ?? 1;
  const receipt = (outcome: ProviderStageUsage["outcome"], pending = false): ProviderStageUsage => ({
    ...(observer?.attemptId ? { attemptId: observer.attemptId } : {}), ...(reasonCode ? { reasonCode } : {}),
    stage: request.stage, configuration: request.configuration, mock: request.mock, outcome, pending, cacheHits: 0,
    providerAttempts: progress.providerAttempts, completedResponses: progress.completedResponses,
    retryAttempts: Math.max(0, progress.providerAttempts - 1), repairAttempts: request.stage === "selection_repair" ? 1 : 0,
    elapsedMs: performance.now() - started, ...usageQuantities(progress.usage, progress.providerAttempts === 0 && progress.completedResponses === 0)
  });
  const usage = (outcome: ProviderStageUsage["outcome"], pending = false): ProviderUsage => {
    const entry = receipt(outcome, pending);
    if (attempted) observer?.update(entry);
    return aggregateProviderUsage(attempted ? [entry] : [], performance.now() - started);
  };
  const failed = (code: C | ProviderFailureCode, pending = false, issues: readonly string[] = []): ProviderAttemptResult<T, C> => {
    reasonCode = code;
    return { code, issues, usage: usage(progress.completedResponses ? "discarded"
      : code === "cancelled" || code === "deadline_exceeded" ? "cancelled" : "failed", pending) };
  };
  const requestedUsage: BudgetUsage = { providerCalls: 1, inputTokens: request.maxInputTokens,
    ...(request.maxOutputTokens === undefined ? {} : { outputTokens: request.maxOutputTokens }), retries: 0,
    ...(request.maxEstimatedCostPerCall === undefined ? {} : { estimatedCost: request.maxEstimatedCostPerCall }) };
  const guard = (): C | ProviderFailureCode | undefined => {
    const stop = stopReason(request); if (stop) return stop;
    if (budget.policy.maxProviderCallsPerRun === 0) return "budget_denied";
    const code = request.guard?.(); if (code) return code;
    if (request.controls?.evaluate({ operation: "provider_call", providerId: request.configuration.provider,
      model: request.configuration.model, runtimeContext: request.runtimeContext,
      usage: observer?.projectedUsage(requestedUsage) ?? requestedUsage }).status === "denied") return "control_denied";
    return undefined;
  };
  try { const code = guard(); if (code) return failed(code); }
  catch { observer?.accountingFailed(); return failed("accounting_unavailable"); }
  const controller = new AbortController();
  const gate = stopGate(request, controller);
  const settle = async (id: string, outcome: ProviderStageUsage["outcome"], noAttempt = false) => {
    try {
      await budget.ledger.settle(id, { outcome, usage: noAttempt ? {} : { ...progress.usage },
        providerAttempts: noAttempt ? 0 : progress.providerAttempts, completedResponses: noAttempt ? 0 : progress.completedResponses,
        elapsedMs: performance.now() - started });
      return true;
    } catch { observer?.accountingFailed(); return false; }
  };
  try {
    const reservation = Promise.resolve().then(() => budget.ledger.reserve({ runId: request.runId, requestId: request.requestId,
      deadlineAt: request.deadlineAt, signal: controller.signal, stage: request.stage, attempt,
      configuration: request.configuration, policy: budget.policy, requestedUsage
    })).then(value => ({ value }), () => ({ error: true as const }));
    const reserved = await Promise.race([reservation, gate.promise]);
    if (typeof reserved === "string") {
      void reservation.then(async result => {
        if ("error" in result) observer?.accountingFailed();
        if ("value" in result && result.value.status === "reserved") await settle(result.value.reservationId, "cancelled", true);
      }).catch(() => observer?.accountingFailed());
      return failed(reserved);
    }
    if ("error" in reserved || !reserved.value || !["denied", "reserved"].includes(reserved.value.status)) {
      observer?.accountingFailed(); return failed("accounting_unavailable");
    }
    if (reserved.value.status === "denied") return failed("budget_denied");
    const id = reserved.value.reservationId;
    if (typeof id !== "string" || !id.trim()) { observer?.accountingFailed(); return failed("accounting_unavailable"); }
    let before: C | ProviderFailureCode | undefined;
    try { before = guard(); } catch { before = "accounting_unavailable"; observer?.accountingFailed(); }
    if (before) {
      const settled = await Promise.race([settle(id, "cancelled", true), gate.promise]);
      return failed(settled === false ? "accounting_unavailable" : before);
    }
    attempted = true;
    observer?.update(receipt("completed", true));
    const completion = (async (): Promise<ProviderAttemptResult<T, C>> => {
      let code: C | ProviderFailureCode | undefined;
      let value: T | undefined;
      let issues: readonly string[] = [];
      try {
        const response = await request.invoke({ signal: controller.signal, deadlineAt: request.deadlineAt, attempt, beforeProviderCall: () => {
          const changed = guard(); if (changed) throw new ProviderPreflightError(changed);
        } });
        progress.completedResponses = 1;
        progress.usage = knownUsage(ownValue(response, "usage"));
        const reported = ownValue(response, "providerAttempts");
        if (Number.isSafeInteger(reported) && (reported as number) >= 0) progress.providerAttempts = Math.max(1, reported as number);
        if (reported !== 1 || !validReportedUsage(ownValue(response, "usage"))
          || progress.usage.inputTokens !== undefined && progress.usage.inputTokens > request.maxInputTokens
          || request.maxOutputTokens !== undefined && progress.usage.outputTokens !== undefined && progress.usage.outputTokens > request.maxOutputTokens) code = request.protocolError ?? "provider_unavailable";
        else {
          const validated = request.validate(response);
          value = validated.value; code = validated.code; issues = validated.issues ?? [];
        }
      } catch (error) {
        if (!progress.completedResponses) {
          progress.usage = knownUsage(ownValue(error, "usage"));
          const reported = ownValue(error, "providerAttempts"), responses = ownValue(error, "completedResponses");
          if (Number.isSafeInteger(reported) && (reported as number) >= 0) progress.providerAttempts = reported as number;
          if (Number.isSafeInteger(responses) && (responses as number) >= 0) progress.completedResponses = responses as number;
          progress.providerAttempts = Math.max(progress.providerAttempts, progress.completedResponses);
          code = error instanceof ProviderPreflightError ? error.code as C | ProviderFailureCode : "provider_unavailable";
        } else code = request.protocolError ?? "provider_unavailable";
      }
      try {
        if (request.estimateCost && progress.usage.estimatedCost === undefined && progress.providerAttempts > 0) {
          const cost = request.estimateCost(Object.freeze({ ...progress.usage }), request.configuration);
          if (cost !== undefined && !nonnegative(cost)) { code = "accounting_unavailable"; observer?.accountingFailed(); }
          else if (cost !== undefined) progress.usage.estimatedCost = cost;
        }
        const changed = guard(); if (changed) code = changed;
      } catch { code = "accounting_unavailable"; observer?.accountingFailed(); }
      const stop = stopReason(request); if (stop) code = stop;
      const outcome = code ? progress.completedResponses ? "discarded" : stop ? "cancelled" : "failed" : "completed";
      if (!await settle(id, outcome)) code = "accounting_unavailable";
      try { const changed = guard(); if (changed) code = changed; }
      catch { code = "accounting_unavailable"; observer?.accountingFailed(); }
      return code ? failed(code, false, issues) : { value, issues, usage: usage("completed") };
    })().catch(() => { observer?.accountingFailed(); return failed("accounting_unavailable"); });
    const finished = await Promise.race([completion, gate.promise]);
    return typeof finished === "string" ? failed(finished, true) : finished;
  } finally { gate.dispose(); }
}

function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function nonnegative(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

function validConfiguration(value: import("./provider-types.js").ProviderModelConfiguration, stage: string): boolean {
  const embedding = ["embedding_build", "query_embedding"].includes(stage);
  return [value.provider, value.model, value.configurationId].every(item => typeof item === "string" && !!item.trim())
    && (value.revision === undefined || typeof value.revision === "string" && !!value.revision.trim())
    && Object.keys(value).every(key => ["provider", "model", "configurationId", "revision", ...(embedding ? ["dimensions"] : [])].includes(key));
}

class ProviderPreflightError extends Error {
  readonly providerAttempts = 0;
  readonly completedResponses = 0;
  readonly usage = {};
  constructor(readonly code: string) { super("Provider preflight denied the attempt."); }
}
