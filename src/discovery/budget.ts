import type { BudgetPolicy, BudgetUsage } from "../controls/types.js";
import { hasOnlyKeys, isRecord, nonblank } from "./configuration.js";
import { DiscoveryError } from "./diagnostics.js";
import { nonnegative, positiveInteger } from "./embedding-configuration.js";
import { stopReason } from "./embeddings.js";
import type { DiscoveryBudgetLedger, ProviderAttemptSettlement } from "./types.js";
import { knownUsage } from "./usage.js";

/** A host may supply its own ledger and existing budget policy instead. */
export interface DiscoveryBudgetScope {
  ledger: DiscoveryBudgetLedger;
  policy: BudgetPolicy;
}

export interface InMemoryDiscoveryBudgetOptions {
  runId: string;
  maxProviderCalls: number;
  maxInputTokens: number;
  maxEstimatedCost?: number;
  maxOutputTokens?: number;
}

/** Single-process, single-run accounting. Outstanding and unknown consumption retain allowance. */
export function createInMemoryDiscoveryBudget(options: InMemoryDiscoveryBudgetOptions): DiscoveryBudgetScope {
  if (!isRecord(options) || !hasOnlyKeys(options, ["runId", "maxProviderCalls", "maxInputTokens", "maxOutputTokens", "maxEstimatedCost"])
    || !nonblank(options.runId) || !positiveInteger(options.maxProviderCalls) || !positiveInteger(options.maxInputTokens)
    || options.maxOutputTokens !== undefined && !positiveInteger(options.maxOutputTokens)
    || options.maxEstimatedCost !== undefined && !nonnegative(options.maxEstimatedCost)) {
    throw new DiscoveryError({ code: "invalid_configuration", message: "An in-memory budget requires a run ID and positive finite call and input-token limits." });
  }
  const runId = options.runId;
  const policy: BudgetPolicy = Object.freeze({
    id: "discovery.in-memory.v1", scope: Object.freeze({ type: "global" }), mode: "hard",
    maxProviderCallsPerRun: options.maxProviderCalls, maxInputTokensPerRun: options.maxInputTokens,
    ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokensPerRun: options.maxOutputTokens }),
    ...(options.maxEstimatedCost === undefined ? {} : { maxEstimatedCostPerRun: options.maxEstimatedCost })
  });
  const pending = new Map<string, Required<Pick<BudgetUsage, "providerCalls" | "inputTokens" | "outputTokens" | "estimatedCost">>>();
  const charged = { providerCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  const held = { providerCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  let sequence = 0;
  const ledger: DiscoveryBudgetLedger = {
    async reserve(input) {
      const denied = () => ({ status: "denied" as const, diagnostic: {
        code: "budget_denied" as const, message: "The in-memory run budget denied this reservation."
      } });
      const usage = input.requestedUsage;
      if (input.runId !== runId || !nonblank(input.requestId) || !Number.isFinite(input.deadlineAt)
        || stopReason(input) || !isRecord(usage) || !positiveInteger(usage.providerCalls)
        || !positiveInteger(usage.inputTokens)
        || usage.outputTokens !== undefined && (typeof usage.outputTokens !== "number" || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0)
        || policy.maxOutputTokensPerRun !== undefined && !["embedding_build", "query_embedding"].includes(input.stage) && !positiveInteger(usage.outputTokens)
        || usage.estimatedCost !== undefined && !nonnegative(usage.estimatedCost)
        || policy.maxEstimatedCostPerRun !== undefined && usage.estimatedCost === undefined) return denied();
      const amounts = { providerCalls: usage.providerCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens ?? 0, estimatedCost: usage.estimatedCost ?? 0 };
      if (charged.providerCalls + held.providerCalls + amounts.providerCalls > policy.maxProviderCallsPerRun!
        || charged.inputTokens + held.inputTokens + amounts.inputTokens > policy.maxInputTokensPerRun!
        || policy.maxOutputTokensPerRun !== undefined && charged.outputTokens + held.outputTokens + amounts.outputTokens > policy.maxOutputTokensPerRun
        || policy.maxEstimatedCostPerRun !== undefined
          && charged.estimatedCost + held.estimatedCost + amounts.estimatedCost > policy.maxEstimatedCostPerRun) return denied();
      // No await between checking capacity and recording the reservation.
      const id = "discovery-reservation-" + ++sequence;
      pending.set(id, amounts);
      for (const key of ["providerCalls", "inputTokens", "outputTokens", "estimatedCost"] as const) held[key] += amounts[key];
      return { status: "reserved", reservationId: id };
    },
    async settle(id: string, result: ProviderAttemptSettlement) {
      const reserved = pending.get(id);
      if (!reserved || !isRecord(result) || !Number.isSafeInteger(result.providerAttempts) || result.providerAttempts < 0
        || !Number.isSafeInteger(result.completedResponses) || result.completedResponses < 0
        || !["completed", "failed", "cancelled", "discarded"].includes(result.outcome)) {
        throw new DiscoveryError({ code: "accounting_unavailable", message: "The budget settlement is invalid or its reservation was already settled." });
      }
      const usage = knownUsage(result.usage);
      // A completed response establishes an attempt even if a malformed client reports zero.
      const attempts = Math.max(result.providerAttempts, result.completedResponses);
      const actual = {
        providerCalls: attempts,
        inputTokens: usage.inputTokens ?? (attempts ? reserved.inputTokens : 0),
        outputTokens: usage.outputTokens ?? (attempts ? reserved.outputTokens : 0),
        estimatedCost: usage.estimatedCost ?? (attempts ? reserved.estimatedCost : 0)
      };
      pending.delete(id);
      for (const key of ["providerCalls", "inputTokens", "outputTokens", "estimatedCost"] as const) {
        held[key] = Math.max(0, held[key] - reserved[key]);
        charged[key] += actual[key];
      }
    }
  };
  return Object.freeze({ ledger: Object.freeze(ledger), policy });
}
