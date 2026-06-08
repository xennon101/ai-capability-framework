export { compareCapabilityVersions } from "./compatibility.js";
export {
  formatGovernanceGateReport,
  loadGovernanceGateConfig,
  runGovernanceGate
} from "./gate.js";
export { analyzeCapabilityImpact } from "./impact.js";
export { evaluateLifecycleTransition } from "./lifecycle.js";
export { compileCapabilityRisk } from "./risk-compiler.js";
export type {
  CapabilityImpactReport,
  CapabilityLifecycleStatus,
  CompatibilityChange,
  CompatibilityDiff,
  CompatibilityLevel,
  GovernanceGateCheck,
  GovernanceGateCheckStatus,
  GovernanceGateConfig,
  GovernanceGateEnvironmentConfig,
  GovernanceGateExitCode,
  GovernanceGateLoadedState,
  GovernanceGateReport,
  GovernanceGateSettings,
  GovernanceActor,
  GovernanceContext,
  GovernanceEvidenceRef,
  GovernanceOverride,
  GovernanceReason,
  GovernanceRequirement,
  GovernanceSeverity,
  ImpactAnalysisOptions,
  ImpactCoverageGap,
  LifecycleTransitionDecision,
  LifecycleTransitionRequest,
  LoadGovernanceGateConfigOptions,
  LoadGovernanceGateConfigResult,
  RequiredControl,
  RequiredControlCode,
  RunGovernanceGateInput,
  RiskCompilationOptions,
  RiskCompilationResult
} from "./types.js";
