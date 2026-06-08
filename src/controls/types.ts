import type { GovernanceActor } from "../governance/index.js";
import type {
  AutonomyTier,
  CapabilityManifest,
  LoadedCapabilityManifest,
  ManifestRegistry,
  RiskTier
} from "../types.js";
import type { AicfRuntimeContext, AicfToolResultOperation } from "../runtime/types.js";
import type { AicfProviderId } from "../providers/shared/types.js";

export type KillSwitchMode = "deny" | "force_approval" | "read_only";

export type AicfControlScope =
  | { type: "global" }
  | { type: "provider"; providerId: AicfProviderId | string }
  | { type: "model"; providerId: AicfProviderId | string; model: string }
  | { type: "capability"; capabilityId: string }
  | { type: "domain"; domain: string }
  | { type: "risk_tier"; riskTier: RiskTier }
  | { type: "tenant"; tenantId: string }
  | { type: "autonomy_tier"; autonomyTier: AutonomyTier };

export interface KillSwitch {
  createdAt: string;
  createdBy?: GovernanceActor;
  expiresAt?: string;
  id: string;
  mode: KillSwitchMode;
  reason: string;
  scope: AicfControlScope;
}

export type CircuitBreakerMetric =
  | "validation_failure_rate"
  | "policy_denial_rate"
  | "provider_error_rate"
  | "approval_rejection_rate"
  | "tool_loop_exceeded_rate"
  | "budget_exceeded_rate"
  | "security_test_failure_rate";

export type CircuitBreakerAction =
  | "open_deny"
  | "open_force_approval"
  | "open_read_only";

export interface CircuitBreakerPolicy {
  action: CircuitBreakerAction;
  id: string;
  metric: CircuitBreakerMetric;
  scope: AicfControlScope;
  threshold: number;
  windowSeconds: number;
}

export interface CircuitBreakerEvent {
  metric: CircuitBreakerMetric;
  occurredAt: string;
  scope: AicfControlScope;
  triggered: boolean;
}

export interface CircuitBreakerState {
  lastEvaluatedAt?: string;
  observedRate?: number;
  openedAt?: string;
  policyId: string;
  status: "closed" | "open";
}

export interface BudgetPolicy {
  id: string;
  maxEstimatedCostPerRun?: number;
  maxInputTokensPerRun?: number;
  maxOutputTokensPerRun?: number;
  maxProviderCallsPerRun?: number;
  maxRetriesPerRun?: number;
  maxRuntimeMsPerRun?: number;
  maxToolCallsPerRun?: number;
  mode?: "hard" | "warn";
  scope: AicfControlScope;
}

export interface BudgetUsage {
  estimatedCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  providerCalls?: number;
  retries?: number;
  runtimeMs?: number;
  toolCalls?: number;
}

export interface BudgetDecision {
  matchedPolicyIds: string[];
  reasons: ControlReason[];
  remaining?: Partial<Record<keyof BudgetUsage, number>>;
  status: "allowed" | "denied" | "warn";
}

export interface ControlReason {
  code: string;
  controlId?: string;
  message: string;
  severity: "info" | "warning" | "error";
  source: "kill_switch" | "circuit_breaker" | "budget";
}

export interface ControlDecision {
  budgetDecision?: BudgetDecision;
  effectiveMode?: KillSwitchMode;
  matchedCircuitBreakers: string[];
  matchedKillSwitches: string[];
  reasons: ControlReason[];
  status: "allowed" | "denied" | "force_approval" | "read_only" | "warn";
  warnings: ControlReason[];
}

export interface RuntimeControlEvaluationInput {
  autonomyTier?: AutonomyTier;
  capability?: LoadedCapabilityManifest | CapabilityManifest;
  capabilityId?: string;
  domain?: string;
  model?: string;
  operation: AicfToolResultOperation | "provider_call" | "export";
  providerId?: AicfProviderId | string;
  registry?: ManifestRegistry;
  riskTier?: RiskTier;
  runtimeContext?: AicfRuntimeContext;
  tenantId?: string;
  usage?: BudgetUsage;
}

export interface AicfRuntimeControls {
  evaluate(input: RuntimeControlEvaluationInput): ControlDecision;
}

export interface AicfControlsStore {
  listBudgetPolicies(): BudgetPolicy[];
  listCircuitBreakerEvents(): CircuitBreakerEvent[];
  listCircuitBreakerPolicies(): CircuitBreakerPolicy[];
  listCircuitBreakerStates(): CircuitBreakerState[];
  listKillSwitches(): KillSwitch[];
  putBudgetPolicy(policy: BudgetPolicy): void;
  putCircuitBreakerPolicy(policy: CircuitBreakerPolicy): void;
  putCircuitBreakerState(state: CircuitBreakerState): void;
  putKillSwitch(killSwitch: KillSwitch): void;
  recordCircuitBreakerEvent(event: CircuitBreakerEvent): void;
}

export interface ControlsSnapshot {
  budgetPolicies: BudgetPolicy[];
  circuitBreakerEvents: CircuitBreakerEvent[];
  circuitBreakerPolicies: CircuitBreakerPolicy[];
  circuitBreakerStates: CircuitBreakerState[];
  killSwitches: KillSwitch[];
}

export interface DefaultControlsEvaluatorOptions extends Partial<ControlsSnapshot> {
  now?: string;
}

export interface LocalJsonControlsFile extends ControlsSnapshot {
  schemaVersion: "1.0";
}
