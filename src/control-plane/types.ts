import type {
  ActionRecord,
  ApprovalRecord,
  PolicyDecisionRecord
} from "../audit/index.js";
import type {
  ControlDecision,
  ControlsSnapshot,
  KillSwitch
} from "../controls/index.js";
import type {
  CapabilityImpactReport,
  GovernanceActor,
  GovernanceGateReport,
  LifecycleTransitionDecision,
  RiskCompilationResult
} from "../governance/index.js";
import type {
  ProviderConformanceReport,
  CanonicalProviderConformanceTarget
} from "../providers/conformance/index.js";
import type { EvidencePack } from "../evidence/index.js";
import type { ReplayTrace } from "../replay/index.js";
import type { SecurityPackCoverageReport } from "../security-packs/index.js";
import type {
  CapabilityManifest,
  LoadedCapabilityManifest,
  ManifestRegistry,
  RiskTier
} from "../types.js";

export interface AicfControlPlaneRequest {
  body?: unknown;
  headers?: Record<string, string | undefined>;
  method: string;
  path: string;
  user?: AicfControlPlaneUser;
}

export interface AicfControlPlaneUser {
  displayName?: string;
  id: string;
  roles?: string[];
}

export interface AicfControlPlaneResponse<TBody = unknown> {
  body: TBody;
  headers?: Record<string, string>;
  status: number;
}

export interface AicfControlPlaneErrorBody {
  error: {
    code: AicfControlPlaneErrorCode;
    message: string;
  };
}

export type AicfControlPlaneErrorCode =
  | "control_plane_invalid_request"
  | "control_plane_not_found"
  | "control_plane_method_not_allowed"
  | "control_plane_store_error";

export interface AicfControlPlaneStoreState {
  actions: ActionRecord[];
  approvals: ApprovalRecord[];
  controls: ControlsSnapshot;
  decisions: PolicyDecisionRecord[];
  replayTraces: ReplayTrace[];
  schemaVersion: "1.0";
}

export interface AicfControlPlaneStore {
  deleteKillSwitch(id: string): Promise<boolean> | boolean;
  getReplayTrace(traceId: string): Promise<ReplayTrace | undefined> | ReplayTrace | undefined;
  listActions(): Promise<ActionRecord[]> | ActionRecord[];
  listApprovals(): Promise<ApprovalRecord[]> | ApprovalRecord[];
  listDecisions(): Promise<PolicyDecisionRecord[]> | PolicyDecisionRecord[];
  listReplayTraces(): Promise<ReplayTrace[]> | ReplayTrace[];
  putKillSwitch(killSwitch: KillSwitch): Promise<KillSwitch> | KillSwitch;
  snapshotControls(): Promise<ControlsSnapshot> | ControlsSnapshot;
  updateApproval(approvalRecordId: string, patch: Partial<ApprovalRecord>): Promise<ApprovalRecord | undefined> | ApprovalRecord | undefined;
}

export interface AicfControlPlaneServiceOptions {
  conformanceProviders?: CanonicalProviderConformanceTarget[];
  conformanceReport?: ProviderConformanceReport;
  gateReport?: GovernanceGateReport;
  manifestRoot?: string;
  now?: string;
  registry: ManifestRegistry;
  serverUrl?: string;
  store: AicfControlPlaneStore;
}

export interface AicfControlPlaneService {
  approveApproval(approvalRecordId: string, input?: ControlPlaneApprovalMutationInput): Promise<ApprovalRecord>;
  buildSnapshot(): Promise<AicfControlPlaneSnapshot>;
  createKillSwitch(input: ControlPlaneCreateKillSwitchInput): Promise<KillSwitch>;
  deleteKillSwitch(id: string): Promise<{ deleted: boolean; id: string }>;
  evaluateLifecycle(capabilityId: string, input: ControlPlaneLifecycleRequestBody): Promise<LifecycleTransitionDecision>;
  exportEvidence(input?: ControlPlaneEvidenceExportInput): Promise<ControlPlaneEvidenceExport>;
  getCapability(id: string): Promise<ControlPlaneCapabilityDetail>;
  getCapabilityImpact(id: string): Promise<CapabilityImpactReport>;
  getConformanceStatus(): Promise<ControlPlaneConformanceStatus>;
  getEvalStatus(): Promise<ControlPlaneEvalStatus>;
  listActions(): Promise<ActionRecord[]>;
  listApprovals(): Promise<ApprovalRecord[]>;
  listCapabilities(): Promise<ControlPlaneCapabilitySummary[]>;
  listDecisions(): Promise<PolicyDecisionRecord[]>;
  listKillSwitches(): Promise<KillSwitch[]>;
  listReplayIndex(): Promise<ControlPlaneReplayIndexItem[]>;
  rejectApproval(approvalRecordId: string, input?: ControlPlaneApprovalMutationInput): Promise<ApprovalRecord>;
}

export interface ControlPlaneCapabilitySummary {
  autonomyTier: CapabilityManifest["autonomy_tier"];
  capabilityType: CapabilityManifest["capability_type"];
  domain?: string;
  exposedOperations: Array<"select" | "prepare">;
  id: string;
  lifecycle: CapabilityManifest["lifecycle"];
  name: string;
  riskTier: RiskTier;
  status: CapabilityManifest["status"];
  version: string;
}

export interface ControlPlaneCapabilityDetail extends ControlPlaneCapabilitySummary {
  controls: ControlDecision;
  description: string;
  impact: CapabilityImpactReport;
  inputProperties: string[];
  owner?: CapabilityManifest["owner"];
  relatedEvalIds: string[];
  risk: RiskCompilationResult;
  securityPacks: SecurityPackCoverageReport["capabilities"][number] | undefined;
  sourcePath: string;
}

export interface ControlPlaneEvalStatus {
  capabilities: Array<{
    capabilityId: string;
    golden: number;
    redTeam: number;
  }>;
  evals: Array<{
    capabilityUnderTest?: string;
    id: string;
    scorerCount: number;
  }>;
  summary: {
    capabilitiesWithEvalCoverage: number;
    evals: number;
    totalCapabilities: number;
  };
}

export interface ControlPlaneConformanceStatus {
  report?: ProviderConformanceReport;
  status: "configured" | "not_configured";
  summary: {
    failed: number;
    passed: number;
    providers: number;
  };
}

export interface ControlPlaneReplayIndexItem {
  capabilityIds: string[];
  createdAt: string;
  provider?: string;
  redactionMode: string;
  runId: string;
  traceId: string;
}

export interface AicfControlPlaneSnapshot {
  actions: ActionRecord[];
  approvals: ApprovalRecord[];
  capabilities: ControlPlaneCapabilitySummary[];
  conformance: ControlPlaneConformanceStatus;
  controls: ControlsSnapshot;
  decisions: PolicyDecisionRecord[];
  evals: ControlPlaneEvalStatus;
  generatedAt: string;
  manifestRoot?: string;
  replays: ControlPlaneReplayIndexItem[];
  schemaVersion: "1.0";
}

export interface ControlPlaneLifecycleRequestBody {
  actor?: GovernanceActor;
  from?: string;
  reason?: string;
  to?: string;
}

export interface ControlPlaneApprovalMutationInput {
  decidedAt?: string;
  reason?: string;
}

export interface ControlPlaneCreateKillSwitchInput {
  createdAt?: string;
  expiresAt?: string;
  id?: string;
  mode?: KillSwitch["mode"];
  reason?: string;
  scope?: KillSwitch["scope"];
}

export interface ControlPlaneEvidenceExportInput {
  includeConformance?: boolean;
  includeReplayIndex?: boolean;
}

export interface ControlPlaneEvidenceExport {
  actions: Array<Pick<ActionRecord, "actionId" | "actionState" | "capabilityId" | "preparedActionId" | "resultHash">>;
  approvals: Array<Pick<ApprovalRecord, "approvalRecordId" | "capabilityId" | "preparedActionId" | "status">>;
  capabilities: ControlPlaneCapabilitySummary[];
  canonicalEvidence?: EvidencePack;
  conformance?: ControlPlaneConformanceStatus;
  controls: Pick<ControlsSnapshot, "budgetPolicies" | "circuitBreakerPolicies" | "circuitBreakerStates" | "killSwitches">;
  decisions: Array<Pick<PolicyDecisionRecord, "capabilityId" | "decision" | "decisionId" | "operation" | "reasons" | "runId">>;
  evals: ControlPlaneEvalStatus;
  exportedAt: string;
  gate?: GovernanceGateReport;
  replays?: ControlPlaneReplayIndexItem[];
  redaction: {
    content: "redacted_refs_and_hashes_only";
    omitted: string[];
  };
  schemaVersion: "1.0";
}

export interface RouteControlPlaneRequestInput {
  request: AicfControlPlaneRequest;
  service: AicfControlPlaneService;
}

export interface BuildControlPlaneSnapshotInput {
  service: AicfControlPlaneService;
}

export interface ExportControlPlaneEvidenceInput {
  input?: ControlPlaneEvidenceExportInput;
  service: AicfControlPlaneService;
}

export type LoadedCapabilityForControlPlane = LoadedCapabilityManifest;
