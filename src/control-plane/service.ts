import { createHash } from "node:crypto";
import { DefaultControlsEvaluator } from "../controls/index.js";
import {
  analyzeCapabilityImpact,
  compileCapabilityRisk,
  evaluateLifecycleTransition,
  type CapabilityLifecycleStatus
} from "../governance/index.js";
import { createEvidencePack } from "../evidence/index.js";
import { runProviderConformanceSuite } from "../providers/conformance/index.js";
import { assessSecurityPackCoverage } from "../security-packs/index.js";
import type {
  CapabilityManifest,
  LoadedCapabilityManifest,
  ManifestRegistry
} from "../types.js";
import { sanitizeControlPlanePayload } from "./redaction.js";
import type {
  AicfControlPlaneService,
  AicfControlPlaneServiceOptions,
  AicfControlPlaneSnapshot,
  BuildControlPlaneSnapshotInput,
  ControlPlaneApprovalMutationInput,
  ControlPlaneCapabilityDetail,
  ControlPlaneCapabilitySummary,
  ControlPlaneConformanceStatus,
  ControlPlaneCreateKillSwitchInput,
  ControlPlaneEvalStatus,
  ControlPlaneEvidenceExport,
  ControlPlaneEvidenceExportInput,
  ControlPlaneLifecycleRequestBody,
  ControlPlaneReplayIndexItem,
  ExportControlPlaneEvidenceInput
} from "./types.js";

const lifecycleStatuses = new Set<string>([
  "draft",
  "review",
  "approved",
  "canary",
  "production",
  "deprecated",
  "disabled",
  "removed"
]);

export function createControlPlaneService(options: AicfControlPlaneServiceOptions): AicfControlPlaneService {
  return new DefaultControlPlaneService(options);
}

export async function buildControlPlaneSnapshot(
  input: BuildControlPlaneSnapshotInput
): Promise<AicfControlPlaneSnapshot> {
  return input.service.buildSnapshot();
}

export async function exportControlPlaneEvidence(
  input: ExportControlPlaneEvidenceInput
): Promise<ControlPlaneEvidenceExport> {
  return input.service.exportEvidence(input.input);
}

class DefaultControlPlaneService implements AicfControlPlaneService {
  private readonly options: AicfControlPlaneServiceOptions;

  constructor(options: AicfControlPlaneServiceOptions) {
    this.options = options;
  }

  async approveApproval(approvalRecordId: string, input: ControlPlaneApprovalMutationInput = {}) {
    const updated = await this.options.store.updateApproval(approvalRecordId, {
      decidedAt: input.decidedAt ?? this.now(),
      decisionReason: input.reason ?? "Approved from the AICF control-plane reference API.",
      status: "approved"
    });
    if (!updated) {
      throw new ControlPlaneServiceError("control_plane_not_found", `Approval "${approvalRecordId}" was not found.`);
    }
    return sanitizeControlPlanePayload(updated);
  }

  async buildSnapshot(): Promise<AicfControlPlaneSnapshot> {
    const snapshot: AicfControlPlaneSnapshot = {
      actions: await this.listActions(),
      approvals: await this.listApprovals(),
      capabilities: await this.listCapabilities(),
      conformance: await this.getConformanceStatus(),
      controls: await this.options.store.snapshotControls(),
      decisions: await this.listDecisions(),
      evals: await this.getEvalStatus(),
      generatedAt: this.now(),
      manifestRoot: this.options.manifestRoot,
      replays: await this.listReplayIndex(),
      schemaVersion: "1.0"
    };
    return sanitizeControlPlanePayload(snapshot);
  }

  async createKillSwitch(input: ControlPlaneCreateKillSwitchInput) {
    if (!input.mode || !["deny", "force_approval", "read_only"].includes(input.mode)) {
      throw new ControlPlaneServiceError("control_plane_invalid_request", "Kill switch mode must be deny, force_approval, or read_only.");
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ControlPlaneServiceError("control_plane_invalid_request", "Kill switch reason is required.");
    }

    const createdAt = input.createdAt ?? this.now();
    const scope = input.scope ?? { type: "global" as const };
    const killSwitch = await this.options.store.putKillSwitch({
      createdAt,
      expiresAt: input.expiresAt,
      id: input.id ?? killSwitchId(input.mode, scope, input.reason, createdAt),
      mode: input.mode,
      reason: input.reason,
      scope
    });
    return sanitizeControlPlanePayload(killSwitch);
  }

  async deleteKillSwitch(id: string) {
    return {
      deleted: await this.options.store.deleteKillSwitch(id),
      id
    };
  }

  async evaluateLifecycle(capabilityId: string, input: ControlPlaneLifecycleRequestBody) {
    const to = input.to;
    if (!to || !lifecycleStatuses.has(to)) {
      throw new ControlPlaneServiceError("control_plane_invalid_request", "Lifecycle request body requires a valid target status in `to`.");
    }
    if (input.from && !lifecycleStatuses.has(input.from)) {
      throw new ControlPlaneServiceError("control_plane_invalid_request", "Lifecycle request body has an invalid `from` status.");
    }

    const decision = evaluateLifecycleTransition(this.options.registry, {
      actor: input.actor,
      capabilityId,
      from: input.from as CapabilityLifecycleStatus | undefined,
      reason: input.reason ?? "Control-plane lifecycle evaluation.",
      to: to as CapabilityLifecycleStatus
    });
    return sanitizeControlPlanePayload(decision);
  }

  async exportEvidence(input: ControlPlaneEvidenceExportInput = {}): Promise<ControlPlaneEvidenceExport> {
    const snapshot = await this.buildSnapshot();
    const exportBody: ControlPlaneEvidenceExport = {
      actions: snapshot.actions.map((action) => ({
        actionId: action.actionId,
        actionState: action.actionState,
        capabilityId: action.capabilityId,
        preparedActionId: action.preparedActionId,
        resultHash: action.resultHash
      })),
      approvals: snapshot.approvals.map((approval) => ({
        approvalRecordId: approval.approvalRecordId,
        capabilityId: approval.capabilityId,
        preparedActionId: approval.preparedActionId,
        status: approval.status
      })),
      capabilities: snapshot.capabilities,
      conformance: input.includeConformance === false ? undefined : snapshot.conformance,
      controls: {
        budgetPolicies: snapshot.controls.budgetPolicies,
        circuitBreakerPolicies: snapshot.controls.circuitBreakerPolicies,
        circuitBreakerStates: snapshot.controls.circuitBreakerStates,
        killSwitches: snapshot.controls.killSwitches
      },
      decisions: snapshot.decisions.map((decision) => ({
        capabilityId: decision.capabilityId,
        decision: decision.decision,
        decisionId: decision.decisionId,
        operation: decision.operation,
        reasons: decision.reasons,
        runId: decision.runId
      })),
      evals: snapshot.evals,
      exportedAt: this.now(),
      gate: this.options.gateReport,
      redaction: {
        content: "redacted_refs_and_hashes_only",
        omitted: [
          "raw prompts",
          "raw provider payloads",
          "raw transcripts",
          "secrets",
          "stack traces",
          "unredacted subject, account, and tenant identifiers"
        ]
      },
      replays: input.includeReplayIndex === false ? undefined : snapshot.replays,
      schemaVersion: "1.0"
    };
    exportBody.canonicalEvidence = createEvidencePack({
      conformanceReport: this.options.conformanceReport,
      controlPlaneEvidence: exportBody,
      environment: this.options.gateReport?.environment,
      gateReport: this.options.gateReport,
      generatedAt: exportBody.exportedAt,
      project: {
        environment: this.options.gateReport?.environment,
        id: this.options.manifestRoot ?? "control-plane",
        name: "AICF Control Plane"
      },
      registry: this.options.registry
    });
    return sanitizeControlPlanePayload(exportBody);
  }

  async getCapability(id: string): Promise<ControlPlaneCapabilityDetail> {
    const loaded = this.mustCapability(id);
    const summary = capabilitySummary(loaded);
    const securityCoverage = assessSecurityPackCoverage(this.options.registry)
      .capabilities
      .find((entry) => entry.capabilityId === id);
    const controls = new DefaultControlsEvaluator(await this.options.store.snapshotControls()).evaluate({
      capability: loaded,
      capabilityId: id,
      domain: loaded.manifest.domain,
      operation: loaded.manifest.lifecycle.prepare ? "prepare" : "select",
      registry: this.options.registry,
      riskTier: loaded.manifest.risk_tier
    });
    const detail: ControlPlaneCapabilityDetail = {
      ...summary,
      controls,
      description: loaded.manifest.model_description ?? loaded.manifest.summary,
      impact: analyzeCapabilityImpact(this.options.registry, id),
      inputProperties: objectPropertyNames(loaded.manifest.input_schema),
      owner: loaded.manifest.owner,
      relatedEvalIds: relatedEvalIds(this.options.registry, id),
      risk: compileCapabilityRisk(loaded.manifest, {
        entities: this.options.registry.entities.map((entity) => entity.manifest)
      }),
      securityPacks: securityCoverage,
      sourcePath: loaded.path
    };
    return sanitizeControlPlanePayload(detail);
  }

  async getCapabilityImpact(id: string) {
    this.mustCapability(id);
    return sanitizeControlPlanePayload(analyzeCapabilityImpact(this.options.registry, id));
  }

  async getConformanceStatus(): Promise<ControlPlaneConformanceStatus> {
    const report = this.options.conformanceReport ?? (
      this.options.conformanceProviders && this.options.conformanceProviders.length > 0
        ? runProviderConformanceSuite({
            providers: this.options.conformanceProviders,
            registry: this.options.registry,
            serverUrl: this.options.serverUrl
          })
        : undefined
    );

    if (!report) {
      return {
        status: "not_configured",
        summary: {
          failed: 0,
          passed: 0,
          providers: 0
        }
      };
    }

    return sanitizeControlPlanePayload({
      report,
      status: "configured",
      summary: {
        failed: report.counts.failed,
        passed: report.counts.passed,
        providers: report.counts.providers
      }
    });
  }

  async getEvalStatus(): Promise<ControlPlaneEvalStatus> {
    const capabilities = this.options.registry.capabilities.map((capability) => ({
      capabilityId: capability.manifest.id,
      golden: capability.manifest.evals?.golden?.length ?? 0,
      redTeam: capability.manifest.evals?.red_team?.length ?? 0
    })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
    const evals = this.options.registry.evals.map((evalCase) => ({
      capabilityUnderTest: evalCase.manifest.capability_under_test,
      id: evalCase.manifest.id,
      scorerCount: scorerCount(evalCase.manifest.expected)
    })).sort((left, right) => left.id.localeCompare(right.id));

    return {
      capabilities,
      evals,
      summary: {
        capabilitiesWithEvalCoverage: capabilities.filter((entry) => entry.golden + entry.redTeam > 0).length,
        evals: evals.length,
        totalCapabilities: capabilities.length
      }
    };
  }

  async listActions() {
    return sanitizeControlPlanePayload((await this.options.store.listActions()).sort((left, right) => left.actionId.localeCompare(right.actionId)));
  }

  async listApprovals() {
    return sanitizeControlPlanePayload((await this.options.store.listApprovals()).sort((left, right) => left.approvalRecordId.localeCompare(right.approvalRecordId)));
  }

  async listCapabilities(): Promise<ControlPlaneCapabilitySummary[]> {
    return this.options.registry.capabilities
      .map(capabilitySummary)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async listDecisions() {
    return sanitizeControlPlanePayload((await this.options.store.listDecisions()).sort((left, right) => left.decisionId.localeCompare(right.decisionId)));
  }

  async listKillSwitches() {
    const controls = await this.options.store.snapshotControls();
    return sanitizeControlPlanePayload(controls.killSwitches.sort((left, right) => left.id.localeCompare(right.id)));
  }

  async listReplayIndex(): Promise<ControlPlaneReplayIndexItem[]> {
    return sanitizeControlPlanePayload((await this.options.store.listReplayTraces())
      .map((trace) => ({
        capabilityIds: trace.capabilitySlice.capabilityIds,
        createdAt: trace.createdAt,
        provider: trace.provider?.id,
        redactionMode: trace.redaction.mode,
        runId: trace.runId,
        traceId: trace.traceId
      }))
      .sort((left, right) => left.traceId.localeCompare(right.traceId)));
  }

  async rejectApproval(approvalRecordId: string, input: ControlPlaneApprovalMutationInput = {}) {
    const updated = await this.options.store.updateApproval(approvalRecordId, {
      decidedAt: input.decidedAt ?? this.now(),
      decisionReason: input.reason ?? "Rejected from the AICF control-plane reference API.",
      status: "rejected"
    });
    if (!updated) {
      throw new ControlPlaneServiceError("control_plane_not_found", `Approval "${approvalRecordId}" was not found.`);
    }
    return sanitizeControlPlanePayload(updated);
  }

  private mustCapability(id: string): LoadedCapabilityManifest {
    const loaded = this.options.registry.capabilityById.get(id);
    if (!loaded) {
      throw new ControlPlaneServiceError("control_plane_not_found", `Capability "${id}" was not found.`);
    }
    return loaded;
  }

  private now(): string {
    return this.options.now ?? new Date().toISOString();
  }
}

export class ControlPlaneServiceError extends Error {
  readonly code: "control_plane_invalid_request" | "control_plane_not_found" | "control_plane_store_error";

  constructor(code: ControlPlaneServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function capabilitySummary(loaded: LoadedCapabilityManifest): ControlPlaneCapabilitySummary {
  const capability = loaded.manifest;
  return {
    autonomyTier: capability.autonomy_tier,
    capabilityType: capability.capability_type,
    domain: capability.domain,
    exposedOperations: capability.lifecycle.prepare ? ["select", "prepare"] : ["select"],
    id: capability.id,
    lifecycle: capability.lifecycle,
    name: capability.name,
    riskTier: capability.risk_tier,
    status: capability.status,
    version: capability.version
  };
}

function relatedEvalIds(registry: ManifestRegistry, capabilityId: string): string[] {
  return registry.evals
    .map((evalCase) => evalCase.manifest)
    .filter((evalCase) => evalCase.capability_under_test === capabilityId
      || (evalCase.expected.selected_capabilities?.includes ?? []).includes(capabilityId)
      || (evalCase.expected.tool_calls ?? []).some((call) => call.capability_id === capabilityId)
      || (evalCase.expected.forbidden_tool_calls ?? []).some((call) => call.capability_id === capabilityId))
    .map((evalCase) => evalCase.id)
    .sort();
}

function objectPropertyNames(schema: unknown): string[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return [];
  }
  return Object.keys(schema.properties).sort();
}

function scorerCount(expected: unknown): number {
  if (!isRecord(expected)) {
    return 0;
  }
  return Object.entries(expected).filter(([, value]) => value !== undefined).length;
}

function killSwitchId(
  mode: string,
  scope: unknown,
  reason: string,
  createdAt: string
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ createdAt, mode, reason, scope }))
    .digest("hex")
    .slice(0, 10);
  return `ks_${mode}_${hash}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
