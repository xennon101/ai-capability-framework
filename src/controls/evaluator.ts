import { isRestrictedCapability } from "../adapter-common.js";
import type { CapabilityManifest, LoadedCapabilityManifest, RiskTier } from "../types.js";
import type {
  BudgetDecision,
  BudgetPolicy,
  BudgetUsage,
  CircuitBreakerAction,
  CircuitBreakerEvent,
  CircuitBreakerPolicy,
  CircuitBreakerState,
  ControlDecision,
  ControlReason,
  DefaultControlsEvaluatorOptions,
  KillSwitch,
  KillSwitchMode,
  RuntimeControlEvaluationInput
} from "./types.js";

const riskRank: Record<RiskTier, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export const defaultBudgetPolicy: BudgetPolicy = {
  id: "aicf.default.runtime_budget",
  maxProviderCallsPerRun: 8,
  maxRetriesPerRun: 2,
  maxRuntimeMsPerRun: 60000,
  maxToolCallsPerRun: 8,
  mode: "hard",
  scope: { type: "global" }
};

export class DefaultControlsEvaluator {
  private readonly budgetPolicies: BudgetPolicy[];
  private readonly circuitBreakerEvents: CircuitBreakerEvent[];
  private readonly circuitBreakerPolicies: CircuitBreakerPolicy[];
  private readonly circuitBreakerStates: CircuitBreakerState[];
  private readonly killSwitches: KillSwitch[];
  private readonly now: string;

  constructor(options: DefaultControlsEvaluatorOptions = {}) {
    this.budgetPolicies = cloneArray(options.budgetPolicies);
    this.circuitBreakerEvents = cloneArray(options.circuitBreakerEvents);
    this.circuitBreakerPolicies = cloneArray(options.circuitBreakerPolicies);
    this.circuitBreakerStates = cloneArray(options.circuitBreakerStates);
    this.killSwitches = cloneArray(options.killSwitches);
    this.now = options.now ?? new Date().toISOString();
  }

  evaluate(input: RuntimeControlEvaluationInput): ControlDecision {
    return evaluateRuntimeControls(input, {
      budgetPolicies: this.budgetPolicies,
      circuitBreakerEvents: this.circuitBreakerEvents,
      circuitBreakerPolicies: this.circuitBreakerPolicies,
      circuitBreakerStates: this.circuitBreakerStates,
      killSwitches: this.killSwitches,
      now: this.now
    });
  }
}

export function evaluateRuntimeControls(
  input: RuntimeControlEvaluationInput,
  options: DefaultControlsEvaluatorOptions = {}
): ControlDecision {
  const killSwitchDecision = evaluateKillSwitches(input, options.killSwitches ?? [], options.now);
  const circuitDecision = evaluateCircuitBreakers(input, {
    events: options.circuitBreakerEvents ?? [],
    now: options.now,
    policies: options.circuitBreakerPolicies ?? [],
    states: options.circuitBreakerStates ?? []
  });
  const budgetPolicies = options.budgetPolicies && options.budgetPolicies.length > 0
    ? options.budgetPolicies
    : [defaultBudgetPolicy];
  const budgetDecision = evaluateBudget(input, budgetPolicies);
  const reasons = [
    ...killSwitchDecision.reasons,
    ...circuitDecision.reasons,
    ...budgetDecision.reasons
  ];
  const warnings = reasons.filter((reason) => reason.severity === "warning");
  const matchedKillSwitches = killSwitchDecision.matchedKillSwitches;
  const matchedCircuitBreakers = circuitDecision.matchedCircuitBreakers;

  if (reasons.some((reason) => reason.severity === "error" && reason.code === "control_denied")) {
    return {
      budgetDecision,
      effectiveMode: "deny",
      matchedCircuitBreakers,
      matchedKillSwitches,
      reasons,
      status: "denied",
      warnings
    };
  }

  if (budgetDecision.status === "denied") {
    return {
      budgetDecision,
      matchedCircuitBreakers,
      matchedKillSwitches,
      reasons,
      status: "denied",
      warnings
    };
  }

  if (killSwitchDecision.effectiveMode === "read_only" || circuitDecision.effectiveMode === "read_only") {
    return {
      budgetDecision,
      effectiveMode: "read_only",
      matchedCircuitBreakers,
      matchedKillSwitches,
      reasons,
      status: "read_only",
      warnings
    };
  }

  if (killSwitchDecision.effectiveMode === "force_approval" || circuitDecision.effectiveMode === "force_approval") {
    return {
      budgetDecision,
      effectiveMode: "force_approval",
      matchedCircuitBreakers,
      matchedKillSwitches,
      reasons,
      status: "force_approval",
      warnings
    };
  }

  if (budgetDecision.status === "warn" || warnings.length > 0) {
    return {
      budgetDecision,
      matchedCircuitBreakers,
      matchedKillSwitches,
      reasons,
      status: "warn",
      warnings
    };
  }

  return {
    budgetDecision,
    matchedCircuitBreakers,
    matchedKillSwitches,
    reasons,
    status: "allowed",
    warnings
  };
}

export function evaluateKillSwitches(
  input: RuntimeControlEvaluationInput,
  killSwitches: KillSwitch[],
  now = new Date().toISOString()
): {
  effectiveMode?: KillSwitchMode;
  matchedKillSwitches: string[];
  reasons: ControlReason[];
} {
  const matched = killSwitches
    .filter((killSwitch) => !isExpired(killSwitch, now))
    .filter((killSwitch) => scopeMatches(killSwitch.scope, input));
  const reasons: ControlReason[] = [];

  for (const killSwitch of matched) {
    const incompatibleReadOnly = killSwitch.mode === "read_only" && readOnlyBlocks(input);
    if (killSwitch.mode === "deny" || incompatibleReadOnly) {
      reasons.push({
        code: "control_denied",
        controlId: killSwitch.id,
        message: killSwitch.mode === "deny"
          ? `Kill switch ${killSwitch.id} denied this operation: ${killSwitch.reason}`
          : `Read-only kill switch ${killSwitch.id} blocks this operation: ${killSwitch.reason}`,
        severity: "error",
        source: "kill_switch"
      });
    } else {
      reasons.push({
        code: killSwitch.mode,
        controlId: killSwitch.id,
        message: `Kill switch ${killSwitch.id} applies ${killSwitch.mode}: ${killSwitch.reason}`,
        severity: killSwitch.mode === "force_approval" ? "warning" : "info",
        source: "kill_switch"
      });
    }
  }

  return {
    effectiveMode: strongestMode(matched.map((killSwitch) => killSwitch.mode), input),
    matchedKillSwitches: matched.map((killSwitch) => killSwitch.id),
    reasons
  };
}

export function evaluateCircuitBreakers(
  input: RuntimeControlEvaluationInput,
  options: {
    events?: CircuitBreakerEvent[];
    now?: string;
    policies?: CircuitBreakerPolicy[];
    states?: CircuitBreakerState[];
  }
): {
  effectiveMode?: KillSwitchMode;
  matchedCircuitBreakers: string[];
  reasons: ControlReason[];
} {
  const now = options.now ?? new Date().toISOString();
  const events = options.events ?? [];
  const openPolicyIds = new Set((options.states ?? [])
    .filter((state) => state.status === "open")
    .map((state) => state.policyId));
  const reasons: ControlReason[] = [];
  const modes: KillSwitchMode[] = [];
  const matchedCircuitBreakers: string[] = [];

  for (const policy of options.policies ?? []) {
    if (!scopeMatches(policy.scope, input)) {
      continue;
    }

    const observedRate = observedCircuitRate(policy, events, now);
    const open = openPolicyIds.has(policy.id) || observedRate >= policy.threshold;
    if (!open) {
      continue;
    }

    const mode = modeForCircuitAction(policy.action);
    const incompatibleReadOnly = mode === "read_only" && readOnlyBlocks(input);
    matchedCircuitBreakers.push(policy.id);
    modes.push(mode);
    reasons.push({
      code: mode === "deny" || incompatibleReadOnly ? "control_denied" : mode,
      controlId: policy.id,
      message: `Circuit breaker ${policy.id} is open for ${policy.metric}.`,
      severity: mode === "deny" || incompatibleReadOnly ? "error" : "warning",
      source: "circuit_breaker"
    });
  }

  return {
    effectiveMode: strongestMode(modes, input),
    matchedCircuitBreakers,
    reasons
  };
}

export function evaluateBudget(
  input: RuntimeControlEvaluationInput,
  budgetPolicies: BudgetPolicy[] = [defaultBudgetPolicy]
): BudgetDecision {
  const usage = input.usage;
  if (!usage) {
    return {
      matchedPolicyIds: [],
      reasons: [],
      status: "allowed"
    };
  }

  const policies = budgetPolicies.filter((policy) => scopeMatches(policy.scope, input));
  const reasons: ControlReason[] = [];
  const remaining: BudgetDecision["remaining"] = {};
  let status: BudgetDecision["status"] = "allowed";

  for (const policy of policies) {
    for (const limit of budgetLimits(policy)) {
      const used = usage[limit.usageKey];
      if (typeof used !== "number") {
        continue;
      }

      remaining[limit.usageKey] = Math.min(
        remaining[limit.usageKey] ?? Number.POSITIVE_INFINITY,
        limit.max - used
      );

      if (used > limit.max) {
        const hard = policy.mode !== "warn";
        reasons.push({
          code: "budget_exceeded",
          controlId: policy.id,
          message: `${limit.label} exceeded ${limit.max}.`,
          severity: hard ? "error" : "warning",
          source: "budget"
        });
        status = hard ? "denied" : status === "denied" ? "denied" : "warn";
      } else if (used >= limit.max * 0.8) {
        reasons.push({
          code: "budget_near_limit",
          controlId: policy.id,
          message: `${limit.label} is near the configured limit ${limit.max}.`,
          severity: "warning",
          source: "budget"
        });
        if (status === "allowed") {
          status = "warn";
        }
      }
    }
  }

  return {
    matchedPolicyIds: policies.map((policy) => policy.id),
    reasons,
    remaining,
    status
  };
}

export function controlDecisionAllowsOperation(decision: ControlDecision): boolean {
  return decision.status !== "denied";
}

export function readOnlyBlocks(input: RuntimeControlEvaluationInput): boolean {
  if (["prepare", "commit"].includes(input.operation)) {
    return true;
  }

  const capability = normalizeCapability(input.capability);
  if (!capability) {
    return false;
  }

  return capability.lifecycle.prepare === true
    || capability.lifecycle.commit === true
    || !["read_data", "retrieve_documents", "compute"].includes(capability.capability_type)
    || isRestrictedCapability(capability);
}

export function controlDecisionToPolicyReasons(decision: ControlDecision): Array<{
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  source: "aicf";
}> {
  return decision.reasons.map((reason) => ({
    code: reason.code,
    message: reason.message,
    severity: reason.severity,
    source: "aicf"
  }));
}

function observedCircuitRate(
  policy: CircuitBreakerPolicy,
  events: CircuitBreakerEvent[],
  now: string
): number {
  const nowMs = Date.parse(now);
  const windowMs = policy.windowSeconds * 1000;
  const matches = events.filter((event) => {
    const age = nowMs - Date.parse(event.occurredAt);
    return event.metric === policy.metric
      && age >= 0
      && age <= windowMs
      && scopeEquals(event.scope, policy.scope);
  });
  if (matches.length === 0) {
    return 0;
  }

  return matches.filter((event) => event.triggered).length / matches.length;
}

function modeForCircuitAction(action: CircuitBreakerAction): KillSwitchMode {
  if (action === "open_force_approval") {
    return "force_approval";
  }
  if (action === "open_read_only") {
    return "read_only";
  }
  return "deny";
}

function strongestMode(modes: KillSwitchMode[], input: RuntimeControlEvaluationInput): KillSwitchMode | undefined {
  if (modes.includes("deny")) {
    return "deny";
  }
  if (modes.includes("read_only") && readOnlyBlocks(input)) {
    return "deny";
  }
  if (modes.includes("read_only")) {
    return "read_only";
  }
  if (modes.includes("force_approval")) {
    return "force_approval";
  }
  return undefined;
}

function scopeMatches(scope: KillSwitch["scope"], input: RuntimeControlEvaluationInput): boolean {
  const capability = normalizeCapability(input.capability);
  switch (scope.type) {
    case "global":
      return true;
    case "provider":
      return scope.providerId === input.providerId;
    case "model":
      return scope.providerId === input.providerId && scope.model === input.model;
    case "capability":
      return scope.capabilityId === (input.capabilityId ?? capability?.id);
    case "domain":
      return scope.domain === (input.domain ?? capability?.domain);
    case "risk_tier":
      return riskRank[input.riskTier ?? capability?.risk_tier ?? "none"] >= riskRank[scope.riskTier];
    case "tenant":
      return scope.tenantId === (input.tenantId ?? input.runtimeContext?.account.tenantId);
    case "autonomy_tier":
      return scope.autonomyTier === (input.autonomyTier ?? input.runtimeContext?.autonomy.autonomyTier);
  }
}

function scopeEquals(left: KillSwitch["scope"], right: KillSwitch["scope"]): boolean {
  return JSON.stringify(sortRecord(left)) === JSON.stringify(sortRecord(right));
}

function normalizeCapability(capability: RuntimeControlEvaluationInput["capability"]): CapabilityManifest | undefined {
  if (!capability) {
    return undefined;
  }

  return isLoadedCapability(capability) ? capability.manifest : capability;
}

function isLoadedCapability(capability: RuntimeControlEvaluationInput["capability"]): capability is LoadedCapabilityManifest {
  return Boolean(capability && "manifest" in capability);
}

function isExpired(killSwitch: KillSwitch, now: string): boolean {
  return Boolean(killSwitch.expiresAt && Date.parse(killSwitch.expiresAt) <= Date.parse(now));
}

function budgetLimits(policy: BudgetPolicy): Array<{
  label: string;
  max: number;
  usageKey: keyof BudgetUsage;
}> {
  return [
    ["tool calls", "toolCalls", policy.maxToolCallsPerRun],
    ["provider calls", "providerCalls", policy.maxProviderCallsPerRun],
    ["input tokens", "inputTokens", policy.maxInputTokensPerRun],
    ["output tokens", "outputTokens", policy.maxOutputTokensPerRun],
    ["estimated cost", "estimatedCost", policy.maxEstimatedCostPerRun],
    ["runtime milliseconds", "runtimeMs", policy.maxRuntimeMsPerRun],
    ["retries", "retries", policy.maxRetriesPerRun]
  ].flatMap(([label, usageKey, max]) => typeof max === "number"
    ? [{ label: String(label), max, usageKey: usageKey as keyof BudgetUsage }]
    : []);
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortRecord);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortRecord(child)]));
  }
  return value;
}

function cloneArray<T>(value: T[] | undefined): T[] {
  return value ? value.map((item) => structuredClone(item)) : [];
}
